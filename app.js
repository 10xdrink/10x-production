// Load environment variables from .env
require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const session = require("express-session");
const passport = require("passport");
const logger = require("./utils/logger");
const { uploadImage } = require("./services/s3Service");
const { compressImage } = require("./utils/imageCompressor");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const expressAsyncErrors = require("express-async-errors"); // To handle async errors

// Load MongoDB session store
const mongoStore = require("./config/mongoSession");

// Middleware imports
const errorMiddleware = require("./middleware/errorMiddleware");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const blogRoutes = require("./routes/blogRoutes");
const faqRoutes = require("./routes/faqRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const couponRoutes = require("./routes/couponRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const reportRoutes = require("./routes/reportRoutes");
const contactRoutes = require("./routes/contactRoutes");
const cartRoutes = require("./routes/cartRoutes");
const validateConfig = require("./utils/validateConfig");
const setupGoogleStrategy = require("./services/googleOAuthService");
const emailListRoutes = require("./routes/emailListRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const tagRoutes = require("./routes/tagRoutes");
const billDeskRoutes = require("./routes/billDeskRoutes");
const billDeskLogsRoutes = require("./routes/billDeskLogs");
const testRoutes = require("./routes/testRoutes");
const paymentRoutes = require('./routes/paymentRoutes');
const influencerRoutes = require('./routes/influencerRoutes');
const influencerUserRoutes = require('./routes/influencerUserRoutes');

// Body parser setup
const { json, urlencoded } = express;

// Validate Configuration
validateConfig();

// Initialize Express App
const app = express();

// Security Middleware - Enhanced Helmet Configuration
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.billdesk.com", "https://cdnjs.cloudflare.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://*.billdesk.com", "https://accounts.google.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:", "https://res.cloudinary.com", "https://*.billdesk.com", "https://*.googleusercontent.com"],
        connectSrc: ["'self'", "https://*.billdesk.com", "https://accounts.google.com", "https://*.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'self'", "https://*.billdesk.com", "https://uat1.billdesk.com", "https://accounts.google.com"],
        childSrc: ["'self'", "https://*.billdesk.com", "https://uat1.billdesk.com", "https://accounts.google.com"],
        formAction: ["'self'", "https://*.billdesk.com", "https://uat1.billdesk.com"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  })
);

// CORS Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
  : [process.env.FRONTEND_URL, process.env.ADMIN_URL, process.env.INFLUENCER_URL, 'http://localhost:5175', process.env.INFLUENCER_PANEL_URL, 'http://localhost:8080'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Body Parsing Middleware with size limits
app.use(json({ limit: '10mb' })); // Prevent large payload DoS
app.use(urlencoded({ extended: true, limit: '10mb' }));

// Data Sanitization against NoSQL query injection
app.use(mongoSanitize());

// Prevent HTTP Parameter Pollution
app.use(hpp());

// Rate Limiting Middleware
const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS
    ? parseInt(process.env.RATE_LIMIT_WINDOW_MS)
    : 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  headers: true,
});
app.use("/api/", apiLimiter); // Rate limiter disabled

// Logging Middleware
app.use(morgan("combined", { stream: logger.stream }));

// Serve static files from the 'public' directory with caching
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: '1d', // Adjust as needed
  etag: false
}));

// Session Configuration with MongoDB store - Enhanced Security
const sessionConfig = {
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: mongoStore,
  name: 'sessionId', // Don't use default 'connect.sid' - makes it harder to fingerprint
  cookie: {
    secure: process.env.NODE_ENV === "production", // true in production (HTTPS only)
    httpOnly: true, // Prevent XSS access to cookie
    sameSite: process.env.NODE_ENV === "production" ? 'strict' : 'lax', // CSRF protection
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    domain: process.env.COOKIE_DOMAIN, // Specify your domain in production
  },
  rolling: true, // Reset expiration on every response
  proxy: process.env.NODE_ENV === "production", // Trust proxy in production
};

app.use(session(sessionConfig));

// Initialize Passport for authentication strategies
app.use(passport.initialize());
app.use(passport.session());
setupGoogleStrategy();

// File Upload Middleware with security restrictions
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(), // Use memory storage for S3
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 1 // Only 1 file at a time
  },
  fileFilter: fileFilter
});

// AWS S3 Configuration Logging
logger.info(
  `AWS S3 configured with Bucket: ${process.env.AWS_S3_BUCKET_NAME} in Region: ${process.env.AWS_REGION_S3 || 'us-east-1'}`
);

// Import authMiddleware for protected upload
const authMiddleware = require('./middleware/authMiddleware');

// Image Upload Route - Protected and validated
app.post("/api/upload", authMiddleware, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }
    
    // Additional MIME type verification (double-check)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: "Invalid file type." });
    }
    
    // Compress image before uploading
    logger.info(`Original image size: ${Math.round(req.file.size / 1024)}KB`);
    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 85,
      format: 'jpeg',
    });
    
    const result = await uploadImage(compressedBuffer, {
      folder: 'uploads',
      originalName: req.file.originalname,
      mimeType: 'image/jpeg',
    });
    res.status(200).json({ success: true, url: result.secure_url, key: result.key });
  } catch (error) {
    logger.error('File upload error:', error);
    next(error);
  }
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/faqs", faqRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/email-list", emailListRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/payments/billdesk", billDeskRoutes);
app.use("/api/billdesk-logs", billDeskLogsRoutes); // BillDesk debugging logs (admin only)
app.use("/api/test", testRoutes);
app.use("/api/influencers", influencerRoutes);
app.use("/api/influencer", influencerUserRoutes);

// Serve an HTML file on the root route to indicate the server is running
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ServerRunning.html"));
});

// Health Check Route
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "API is healthy." });
  logger.info("Health check passed");
});

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: "Resource not found" });
});

// Error Handling Middleware
app.use(errorMiddleware);

module.exports = app;
