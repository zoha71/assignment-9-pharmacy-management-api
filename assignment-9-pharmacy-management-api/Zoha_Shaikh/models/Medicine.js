const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide medicine name'],
      trim: true
    },
    brand: {
      type: String,
      required: [true, 'Please provide medicine brand'],
      trim: true
    },
    category: {
      type: String,
      required: [true, 'Please provide medicine category'],
      trim: true
    },
    dosageForm: {
      type: String,
      enum: {
        values: ['Tablet', 'Capsule', 'Syrup', 'Injection'],
        message: 'Dosage form must be Tablet, Capsule, Syrup, or Injection'
      },
      required: [true, 'Please provide dosage form']
    },
    price: {
      type: Number,
      required: [true, 'Please provide medicine price'],
      min: [0, 'Price cannot be negative']
    },
    stockQuantity: {
      type: Number,
      required: [true, 'Please provide stock quantity'],
      min: [0, 'Stock quantity cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value for stock quantity'
      }
    },
    requiresPrescription: {
      type: Boolean,
      default: false
    },
    expiryDate: {
      type: Date,
      required: [true, 'Please provide expiry date']
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual property to check if medicine is expired
medicineSchema.virtual('isExpired').get(function () {
  return this.expiryDate ? new Date(this.expiryDate) < new Date() : false;
});

// Indexes for fast searching, filtering, and expiring queries
medicineSchema.index({ name: 1 });
medicineSchema.index({ category: 1 });
medicineSchema.index({ expiryDate: 1 });
medicineSchema.index({ brand: 1 });

module.exports = mongoose.model('Medicine', medicineSchema);
