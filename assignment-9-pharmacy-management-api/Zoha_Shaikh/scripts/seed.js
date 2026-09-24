const dotenv = require('dotenv');
dotenv.config();

const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Order = require('../models/Order');

const seedData = async (shouldDisconnect = (require.main === module)) => {
  const isReset = process.argv.includes('--reset');

  try {
    await connectDB();
    console.log(`\n🌱 Starting database seeding (Reset mode: ${isReset ? 'ENABLED' : 'DISABLED'})...\n`);

    if (isReset) {
      console.log('🗑️  Wiping existing database collections...');
      await Order.deleteMany({});
      await Medicine.deleteMany({});
      await User.deleteMany({});
      console.log('✅ Collections wiped cleanly.\n');
    }

    // 1. Seed Users
    const usersToSeed = [
      {
        name: 'System Admin',
        email: 'admin@pharmacy.com',
        password: 'Admin@123',
        role: 'admin',
        phone: '+1-555-0101',
        address: '100 Pharmacy Blvd, Suite 1'
      },
      {
        name: 'Senior Pharmacist',
        email: 'pharmacist@pharmacy.com',
        password: 'Pharma@123',
        role: 'pharmacist',
        phone: '+1-555-0102',
        address: '100 Pharmacy Blvd, Dispensing Room'
      },
      {
        name: 'John Doe',
        email: 'customer@pharmacy.com',
        password: 'Customer@123',
        role: 'customer',
        phone: '+1-555-0103',
        address: '42 Baker Street, London'
      }
    ];

    const seededUsers = [];
    for (const userData of usersToSeed) {
      let user = await User.findOne({ email: userData.email });
      if (!user) {
        user = await User.create(userData);
        console.log(`👤 Created user: ${user.email} (${user.role})`);
      } else {
        console.log(`ℹ️  User already exists: ${user.email} (${user.role})`);
      }
      seededUsers.push(user);
    }

    // 2. Seed Medicines
    const now = new Date();
    const daysFromNow = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const medicinesToSeed = [
      {
        name: 'Amoxicillin 500mg',
        brand: 'Amoxil',
        category: 'Antibiotic',
        dosageForm: 'Capsule',
        price: 14.99,
        stockQuantity: 50,
        requiresPrescription: true,
        expiryDate: daysFromNow(180)
      },
      {
        name: 'Paracetamol 650mg',
        brand: 'Dolo',
        category: 'Analgesic',
        dosageForm: 'Tablet',
        price: 4.5,
        stockQuantity: 120,
        requiresPrescription: false,
        expiryDate: daysFromNow(365)
      },
      {
        name: 'Azithromycin 250mg',
        brand: 'Zithromax',
        category: 'Antibiotic',
        dosageForm: 'Tablet',
        price: 22.0,
        stockQuantity: 3, // Low Stock & Expiring soon
        requiresPrescription: true,
        expiryDate: daysFromNow(12) // Expiring in 12 days
      },
      {
        name: 'Ibuprofen 400mg',
        brand: 'Advil',
        category: 'Analgesic',
        dosageForm: 'Tablet',
        price: 8.25,
        stockQuantity: 75,
        requiresPrescription: false,
        expiryDate: daysFromNow(240)
      },
      {
        name: 'Omeprazole 20mg',
        brand: 'Prilosec',
        category: 'Antacid',
        dosageForm: 'Capsule',
        price: 16.5,
        stockQuantity: 5, // Low Stock & Expiring soon
        requiresPrescription: false,
        expiryDate: daysFromNow(20) // Expiring in 20 days
      },
      {
        name: 'Cough Relief Syrup 100ml',
        brand: 'Benadryl',
        category: 'Antihistamine',
        dosageForm: 'Syrup',
        price: 9.75,
        stockQuantity: 40,
        requiresPrescription: false,
        expiryDate: daysFromNow(90)
      },
      {
        name: 'Vitamin D3 60000 IU',
        brand: 'Calcirol',
        category: 'Vitamin',
        dosageForm: 'Capsule',
        price: 12.0,
        stockQuantity: 85,
        requiresPrescription: false,
        expiryDate: daysFromNow(300)
      },
      {
        name: 'Ceftriaxone 1g',
        brand: 'Rocephin',
        category: 'Antibiotic',
        dosageForm: 'Injection',
        price: 35.0,
        stockQuantity: 25,
        requiresPrescription: true,
        expiryDate: daysFromNow(150)
      },
      {
        name: 'Multivitamin Complex 200ml',
        brand: 'Becadexamin',
        category: 'Vitamin',
        dosageForm: 'Syrup',
        price: 11.5,
        stockQuantity: 30,
        requiresPrescription: false,
        expiryDate: daysFromNow(25) // Expiring in 25 days
      },
      {
        name: 'Expired Allergy Relief 10mg',
        brand: 'Histafree',
        category: 'Antihistamine',
        dosageForm: 'Tablet',
        price: 3.0,
        stockQuantity: 15,
        requiresPrescription: false,
        expiryDate: daysFromNow(-30) // Expired 30 days ago
      }
    ];

    console.log('\n💊 Seeding medicines catalog...');
    for (const medData of medicinesToSeed) {
      const existing = await Medicine.findOne({ name: medData.name });
      if (!existing) {
        await Medicine.create(medData);
        console.log(`  + Added: ${medData.name} (${medData.category}) - Stock: ${medData.stockQuantity}, Exp: ${medData.expiryDate.toISOString().split('T')[0]}`);
      } else {
        console.log(`  = Exists: ${medData.name}`);
      }
    }

    console.log('\n======================================================');
    console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('======================================================');
    console.log('🔑 Seeded User Credentials:');
    console.log('   Admin:      admin@pharmacy.com      / Admin@123');
    console.log('   Pharmacist: pharmacist@pharmacy.com / Pharma@123');
    console.log('   Customer:   customer@pharmacy.com   / Customer@123');
    console.log('======================================================\n');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    if (shouldDisconnect) process.exit(1);
    throw error;
  } finally {
    if (shouldDisconnect) {
      await disconnectDB(true);
    }
  }
};

if (require.main === module) {
  seedData(true);
}

module.exports = seedData;
