const mongoose = require('mongoose');
const User = require('./models/User');
const Room = require('./models/Room');
const Booking = require('./models/Booking');
require('dotenv').config();

const seedData = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);

    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});

    // Create sample users
    const users = await User.create([
      {
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin',
        originInstitution: 'Pustaka Wilayah Aceh',
        phoneNumber: '081234567890',
        isVerified: true
      },
      {
        name: 'John Doe',
        email: 'user@example.com',
        password: 'password123',
        role: 'user',
        originInstitution: 'Universitas Syiah Kuala',
        phoneNumber: '081234567891',
        isVerified: true
      }
    ]);

    console.log('Users created:', users.length);

    // Create sample rooms
    const rooms = await Room.create([
      {
        roomName: 'Ruang Seminar Utama',
        capacity: 100,
        location: 'Lantai 1',
        description: 'Ruang seminar berkapasitas besar dengan fasilitas lengkap',
        operatingHours: {
          start: '08:00',
          end: '17:00'
        },
        facilities: ['Proyektor', 'Sound System', 'AC', 'WiFi'],
        image: 'uploads/rooms/sample1.jpg',
        isActive: true
      },
      {
        roomName: 'Ruang Meeting Kecil',
        capacity: 20,
        location: 'Lantai 2',
        description: 'Ruang meeting intimate untuk diskusi kelompok kecil',
        operatingHours: {
          start: '08:00',
          end: '17:00'
        },
        facilities: ['Proyektor', 'Whiteboard', 'AC'],
        image: 'uploads/rooms/sample2.jpg',
        isActive: true
      }
    ]);

    console.log('Rooms created:', rooms.length);

    // Create sample bookings
    const bookings = await Booking.create([
      {
        userId: users[1]._id,
        roomId: rooms[0]._id,
        activityName: 'Seminar Teknologi',
        purpose: 'Seminar tentang perkembangan teknologi terkini',
        startTime: new Date('2025-09-30T09:00:00Z'),
        endTime: new Date('2025-09-30T12:00:00Z'),
        status: 'approved',
        participantsCount: 50,
        documentPath: 'uploads/documents/sample.pdf',
        notes: 'Persiapan seminar teknologi'
      },
      {
        userId: users[1]._id,
        roomId: rooms[1]._id,
        activityName: 'Meeting Tim',
        purpose: 'Rapat koordinasi tim proyek',
        startTime: new Date('2025-10-01T14:00:00Z'),
        endTime: new Date('2025-10-01T16:00:00Z'),
        status: 'pending',
        participantsCount: 10,
        documentPath: 'uploads/documents/sample2.pdf',
        notes: 'Rapat bulanan tim'
      }
    ]);

    console.log('Bookings created:', bookings.length);

    console.log('Sample data seeded successfully!');
    console.log('Admin login: admin@example.com / password123');
    console.log('User login: user@example.com / password123');

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

seedData();