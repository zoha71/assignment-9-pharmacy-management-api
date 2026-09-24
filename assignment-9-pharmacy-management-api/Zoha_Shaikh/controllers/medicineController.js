const Medicine = require('../models/Medicine');
const { isValidObjectId, escapeRegex } = require('../utils/validators');

/**
 * @desc    Get all medicines with search, filter, pagination, and sorting
 * @route   GET /api/medicines
 * @access  Public (Optional Auth for includeExpired)
 */
const getMedicines = async (req, res, next) => {
  try {
    const {
      search,
      category,
      dosageForm,
      minPrice,
      maxPrice,
      inStock,
      requiresPrescription,
      includeExpired,
      sort,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Search by name or brand (case-insensitive with regex escaping)
    if (search && search.trim()) {
      const sanitized = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: sanitized, $options: 'i' } },
        { brand: { $regex: sanitized, $options: 'i' } }
      ];
    }

    // Category filter (case-insensitive exact)
    if (category && category.trim()) {
      query.category = { $regex: new RegExp(`^${escapeRegex(category.trim())}$`, 'i') };
    }

    // Dosage form filter
    if (dosageForm && dosageForm.trim()) {
      query.dosageForm = dosageForm.trim();
    }

    // Price filters
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined) {
        const parsedMin = Number(minPrice);
        if (isNaN(parsedMin) || parsedMin < 0) {
          return res.status(400).json({ success: false, message: 'Invalid minPrice parameter' });
        }
        query.price.$gte = parsedMin;
      }
      if (maxPrice !== undefined) {
        const parsedMax = Number(maxPrice);
        if (isNaN(parsedMax) || parsedMax < 0) {
          return res.status(400).json({ success: false, message: 'Invalid maxPrice parameter' });
        }
        query.price.$lte = parsedMax;
      }
    }

    // In-stock filter
    if (inStock !== undefined) {
      if (inStock === 'true') {
        query.stockQuantity = { $gt: 0 };
      } else if (inStock === 'false') {
        query.stockQuantity = 0;
      }
    }

    // Prescription filter
    if (requiresPrescription !== undefined) {
      if (requiresPrescription === 'true') {
        query.requiresPrescription = true;
      } else if (requiresPrescription === 'false') {
        query.requiresPrescription = false;
      }
    }

    // Expired medicines filter
    // Only authenticated staff members (pharmacist or admin) can request includeExpired=true
    const isStaff = req.user && ['pharmacist', 'admin'].includes(req.user.role);
    const allowExpired = isStaff && includeExpired === 'true';

    if (!allowExpired) {
      query.expiryDate = { $gt: new Date() };
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort) {
      switch (sort) {
        case 'price_asc':
          sortOption = { price: 1 };
          break;
        case 'price_desc':
          sortOption = { price: -1 };
          break;
        case 'name_asc':
          sortOption = { name: 1 };
          break;
        case 'name_desc':
          sortOption = { name: -1 };
          break;
        case 'expiry_asc':
          sortOption = { expiryDate: 1 };
          break;
        default:
          return res.status(400).json({
            success: false,
            message: `Invalid sort parameter: '${sort}'. Valid values: price_asc, price_desc, name_asc, name_desc, expiry_asc`
          });
      }
    }

    // Pagination validation
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ success: false, message: 'Page must be a positive integer' });
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ success: false, message: 'Limit must be an integer between 1 and 100' });
    }

    const skip = (pageNum - 1) * limitNum;
    const total = await Medicine.countDocuments(query);
    const medicines = await Medicine.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);

    const pages = Math.ceil(total / limitNum) || 1;

    res.status(200).json({
      success: true,
      count: medicines.length,
      total,
      page: pageNum,
      pages,
      medicines
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get medicines expiring in the next N days (default 30 days) using aggregation
 * @route   GET /api/medicines/expiring (and GET /api/reports/expiring-soon)
 * @access  Private (Pharmacist / Admin)
 */
const getExpiringMedicines = async (req, res, next) => {
  try {
    const daysParam = req.query.days || 30;
    const days = parseInt(daysParam, 10);

    if (isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter ?days must be an integer between 1 and 365'
      });
    }

    const now = new Date();
    const futureLimit = new Date();
    futureLimit.setDate(now.getDate() + days);

    // MongoDB Aggregation Pipeline
    const medicines = await Medicine.aggregate([
      {
        $match: {
          expiryDate: {
            $gte: now,
            $lte: futureLimit
          }
        }
      },
      {
        $sort: { expiryDate: 1 }
      },
      {
        $project: {
          name: 1,
          brand: 1,
          category: 1,
          dosageForm: 1,
          price: 1,
          stockQuantity: 1,
          requiresPrescription: 1,
          expiryDate: 1,
          createdAt: 1,
          updatedAt: 1,
          daysUntilExpiry: {
            $dateDiff: {
              startDate: '$$NOW',
              endDate: '$expiryDate',
              unit: 'day'
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      days,
      count: medicines.length,
      medicines
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get low stock medicines alert using MongoDB aggregation with $facet
 * @route   GET /api/medicines/low-stock (and GET /api/reports/low-stock)
 * @access  Private (Pharmacist / Admin)
 */
const getLowStockMedicines = async (req, res, next) => {
  try {
    const thresholdParam = req.query.threshold || 10;
    const threshold = parseInt(thresholdParam, 10);

    if (isNaN(threshold) || threshold < 0) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter ?threshold must be a non-negative integer'
      });
    }

    const now = new Date();

    const [result] = await Medicine.aggregate([
      {
        $match: {
          stockQuantity: { $lte: threshold },
          expiryDate: { $gt: now }
        }
      },
      {
        $facet: {
          medicines: [
            { $sort: { stockQuantity: 1, name: 1 } }
          ],
          categorySummary: [
            {
              $group: {
                _id: '$category',
                count: { $sum: 1 },
                totalUnits: { $sum: '$stockQuantity' }
              }
            },
            { $sort: { count: -1 } }
          ],
          totalStats: [
            { $count: 'totalLowStock' }
          ]
        }
      }
    ]);

    const totalLowStock = (result.totalStats[0] && result.totalStats[0].totalLowStock) || 0;

    res.status(200).json({
      success: true,
      threshold,
      count: result.medicines.length,
      summary: {
        totalLowStock,
        categories: result.categorySummary.map((cat) => ({
          category: cat._id,
          medicineCount: cat.count,
          totalUnitsRemaining: cat.totalUnits
        }))
      },
      medicines: result.medicines
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add new medicine
 * @route   POST /api/medicines
 * @access  Private (Pharmacist / Admin)
 */
const createMedicine = async (req, res, next) => {
  try {
    const {
      name,
      brand,
      category,
      dosageForm,
      price,
      stockQuantity,
      requiresPrescription,
      expiryDate
    } = req.body;

    // Required fields check
    if (!name || !brand || !category || !dosageForm || price === undefined || stockQuantity === undefined || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: name, brand, category, dosageForm, price, stockQuantity, expiryDate'
      });
    }

    // Number validations
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a non-negative number'
      });
    }

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Stock quantity must be a non-negative integer'
      });
    }

    // DosageForm enum check
    const allowedForms = ['Tablet', 'Capsule', 'Syrup', 'Injection'];
    if (!allowedForms.includes(dosageForm)) {
      return res.status(400).json({
        success: false,
        message: `Invalid dosageForm. Must be one of: ${allowedForms.join(', ')}`
      });
    }

    // Expiry date must be valid and in the future
    const parsedExpiry = new Date(expiryDate);
    if (isNaN(parsedExpiry.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expiry date format'
      });
    }

    if (parsedExpiry <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Expiry date must be a date in the future'
      });
    }

    const medicine = await Medicine.create({
      name: name.trim(),
      brand: brand.trim(),
      category: category.trim(),
      dosageForm,
      price,
      stockQuantity,
      requiresPrescription: Boolean(requiresPrescription),
      expiryDate: parsedExpiry
    });

    res.status(201).json({
      success: true,
      message: 'Medicine added to inventory successfully',
      medicine
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update medicine stock or pricing
 * @route   PUT /api/medicines/:id
 * @access  Private (Pharmacist / Admin)
 */
const updateMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid medicine ID: ${id}`
      });
    }

    // Allowed fields to update
    const allowedFields = [
      'name',
      'brand',
      'category',
      'dosageForm',
      'price',
      'stockQuantity',
      'requiresPrescription',
      'expiryDate'
    ];

    const updates = {};
    Object.keys(req.body).forEach((key) => {
      if (allowedFields.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid field must be provided for update'
      });
    }

    // Validate price if present
    if (updates.price !== undefined && (typeof updates.price !== 'number' || updates.price < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a non-negative number'
      });
    }

    // Validate stockQuantity if present
    if (
      updates.stockQuantity !== undefined &&
      (!Number.isInteger(updates.stockQuantity) || updates.stockQuantity < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Stock quantity must be a non-negative integer'
      });
    }

    // Validate expiryDate if present
    if (updates.expiryDate !== undefined) {
      const parsedExpiry = new Date(updates.expiryDate);
      if (isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expiry date format'
        });
      }
      updates.expiryDate = parsedExpiry;
    }

    const medicine = await Medicine.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: `Medicine with ID ${id} not found`
      });
    }

    res.status(200).json({
      success: true,
      message: 'Medicine updated successfully',
      medicine
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete medicine
 * @route   DELETE /api/medicines/:id
 * @access  Private (Admin Only)
 */
const deleteMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid medicine ID: ${id}`
      });
    }

    const medicine = await Medicine.findByIdAndDelete(id);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: `Medicine with ID ${id} not found`
      });
    }

    res.status(200).json({
      success: true,
      message: `Medicine '${medicine.name}' removed successfully from database`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMedicines,
  getExpiringMedicines,
  getLowStockMedicines,
  createMedicine,
  updateMedicine,
  deleteMedicine
};
