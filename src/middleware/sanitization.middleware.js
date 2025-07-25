import mongoose from 'mongoose';
import validator from 'validator';

// Middleware sanitization cho MongoDB
export const sanitizeInput = (req, res, next) => {
  // Sanitize tất cả string inputs
  const sanitizeObject = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Escape HTML và remove potential injection chars
        obj[key] = validator.escape(obj[key]);
        // Remove MongoDB operators
        obj[key] = obj[key].replace(/[\$\.]/g, '');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  sanitizeObject(req.body);
  sanitizeObject(req.query);
  sanitizeObject(req.params);

  next();
};

// Validate ObjectId
export const validateObjectId = (paramName) => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        error: `Invalid ${paramName} format` 
      });
    }
    
    next();
  };
};