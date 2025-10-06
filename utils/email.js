const nodemailer = require('nodemailer');
require('dotenv').config();

// ====================================================================
// REKOMENDASI: Buat transporter HANYA SEKALI dan gunakan kembali.
// Ini jauh lebih efisien daripada membuat koneksi baru untuk setiap email.
// Opsi 'tls' yang tidak aman juga telah dihapus.
// ====================================================================
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT == 465, // True jika port 465, false untuk port lain
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ====================================================================
// REKOMENDASI: Pindahkan fungsi helper ke luar agar tidak duplikat (Prinsip DRY)
// ====================================================================
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const formatTime = (date) => {
  return new Date(date).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit'
  });
};


// ====================================================================
// FUNGSI PENGIRIMAN EMAIL
// Setiap fungsi di bawah ini sekarang menggunakan 'transporter' yang sama.
// ====================================================================

/**
 * Mengirim email verifikasi pendaftaran.
 */
const sendVerificationEmail = async (user, verificationToken) => {
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}&email=${user.email}`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verifikasi Email - PerpusBooking</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
        .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>PerpusBooking</h1><h2>Verifikasi Email Anda</h2></div>
        <div class="content">
          <p>Halo ${user.name},</p>
          <p>Terima kasih telah mendaftar. Untuk mengaktifkan akun Anda, silakan klik tombol di bawah ini:</p>
          <div style="text-align: center;"><a href="${verificationUrl}" class="button">Verifikasi Email</a></div>
          <p>Link ini akan kedaluwarsa dalam 24 jam.</p>
          <p>Jika Anda tidak mendaftar, abaikan email ini.</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} PerpusBooking - Pustaka Wilayah Aceh</p></div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `PerpusBooking <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: 'Verifikasi Email - PerpusBooking',
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Verification email sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new Error('Gagal mengirim email verifikasi');
  }
};

/**
 * Mengirim notifikasi status peminjaman ruangan.
 */
const sendBookingNotification = async (booking, status) => {
  let statusText, statusColor, message;
  switch (status) {
    case 'approved':
      statusText = 'DISETUJUI'; statusColor = '#10b981';
      message = 'Selamat! Pengajuan peminjaman ruang Anda telah disetujui.'; break;
    case 'rejected':
      statusText = 'DITOLAK'; statusColor = '#ef4444';
      message = 'Mohon maaf, pengajuan peminjaman ruang Anda tidak dapat disetujui.'; break;
    default:
      statusText = 'PENDING'; statusColor = '#f59e0b';
      message = 'Pengajuan peminjaman ruang Anda sedang diproses.';
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Update Status Booking - PerpusBooking</title>
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
      .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
      .content { padding: 20px; }
      .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; color: white; font-weight: bold; background-color: ${statusColor}; }
      .booking-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
      .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>PerpusBooking</h1><h2>Update Status Peminjaman</h2></div>
      <div class="content">
        <p>Halo ${booking.userId.name},</p>
        <p>${message}</p>
        <div style="text-align: center; margin: 20px 0;"><span class="status-badge">${statusText}</span></div>
        <div class="booking-details">
          <h3>Detail Peminjaman:</h3>
          <div class="detail-row"><strong>Nama Kegiatan:</strong><span>${booking.activityName}</span></div>
          <div class="detail-row"><strong>Ruangan:</strong><span>${booking.roomId.roomName}</span></div>
          <div class="detail-row"><strong>Tanggal:</strong><span>${formatDate(booking.startTime)}</span></div>
          <div class="detail-row"><strong>Waktu:</strong><span>${formatTime(booking.startTime)} - ${formatTime(booking.endTime)}</span></div>
          ${booking.adminNote ? `<div class="detail-row"><strong>Catatan Admin:</strong><span>${booking.adminNote}</span></div>` : ''}
        </div>
      </div>
      <div class="footer"><p>&copy; ${new Date().getFullYear()} PerpusBooking - Pustaka Wilayah Aceh</p></div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: `PerpusBooking <${process.env.EMAIL_FROM}>`,
    to: booking.userId.email,
    subject: `Update Status Peminjaman - ${statusText}`,
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Booking notification sent to ${booking.userId.email}`);
  } catch (error) {
    console.error('Error sending booking notification:', error);
    throw new Error('Gagal mengirim notifikasi email');
  }
};

/**
 * Mengirim notifikasi status tur perpustakaan.
 */
const sendTourNotification = async (tour, status) => {
    // Validasi data tour dan userId
    if (!tour || !tour.userId) {
        console.error('Error: Tour or userId is missing');
        throw new Error('Data tur tidak lengkap');
    }

    // Validasi email
    const recipientEmail = tour.userId.email;
    if (!recipientEmail) {
        console.error('Error: User email is missing for tour:', tour._id);
        throw new Error('Email pengguna tidak ditemukan');
    }

    let statusText, statusColor, message;
    switch (status) {
        case 'approved':
            statusText = 'DISETUJUI'; statusColor = '#10b981';
            message = 'Selamat! Pengajuan tur perpustakaan Anda telah disetujui.'; break;
        case 'rejected':
            statusText = 'DITOLAK'; statusColor = '#ef4444';
            message = 'Mohon maaf, pengajuan tur perpustakaan Anda tidak dapat disetujui.'; break;
        default:
            statusText = 'PENDING'; statusColor = '#f59e0b';
            message = 'Pengajuan tur perpustakaan Anda sedang diproses.';
    }

    const userName = tour.userId.name || 'Pengguna';
    const groupName = tour.groupName || 'Tidak disebutkan';
    const participants = tour.numberOfParticipants || 0;

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Update Status Tur - PerpusBooking</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
        .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; color: white; font-weight: bold; background-color: ${statusColor}; }
        .tour-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>PerpusBooking</h1><h2>Update Status Tur</h2></div>
        <div class="content">
          <p>Halo ${userName},</p>
          <p>${message}</p>
          <div style="text-align: center; margin: 20px 0;"><span class="status-badge">${statusText}</span></div>
          <div class="tour-details">
            <h3>Detail Tur:</h3>
            <div class="detail-row"><strong>Nama Kelompok:</strong><span>${groupName}</span></div>
            <div class="detail-row"><strong>Jumlah Peserta:</strong><span>${participants} orang</span></div>
            <div class="detail-row"><strong>Tanggal:</strong><span>${formatDate(tour.tourDate)}</span></div>
            <div class="detail-row"><strong>Waktu:</strong><span>${formatTime(tour.startTime)}</span></div>
            ${tour.adminNote ? `<div class="detail-row"><strong>Catatan Admin:</strong><span>${tour.adminNote}</span></div>` : ''}
          </div>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} PerpusBooking - Pustaka Wilayah Aceh</p></div>
      </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `PerpusBooking <${process.env.EMAIL_FROM}>`,
        to: recipientEmail,
        subject: `Update Status Tur Perpustakaan - ${statusText}`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Tour notification sent to ${recipientEmail}`);
    } catch (error) {
        console.error('Error sending tour notification:', error);
        console.error('Mail options:', mailOptions);
        throw new Error('Gagal mengirim notifikasi email');
    }
};

/**
 * Mengirim email untuk reset password.
 */
const sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}&email=${user.email}`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Reset Password - PerpusBooking</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
        .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .button { display: inline-block; background-color: #ef4444; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>PerpusBooking</h1><h2>Reset Password</h2></div>
        <div class="content">
          <p>Halo ${user.name},</p>
          <p>Kami menerima permintaan reset password. Klik tombol di bawah untuk melanjutkan:</p>
          <div style="text-align: center;"><a href="${resetUrl}" class="button">Reset Password</a></div>
          <p>Link ini hanya berlaku selama 10 menit.</p>
          <p>Jika Anda tidak meminta reset password, abaikan email ini.</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} PerpusBooking - Pustaka Wilayah Aceh</p></div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `PerpusBooking <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: 'Reset Password - PerpusBooking',
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new Error('Gagal mengirim email reset password');
  }
};

/**
 * Mengirim email selamat datang setelah verifikasi berhasil.
 */
const sendWelcomeEmail = async (user) => {
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Selamat Datang - PerpusBooking</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; }
        .header { background-color: #10b981; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>🎉 Selamat Datang di PerpusBooking!</h1></div>
        <div class="content">
          <p>Halo ${user.name},</p>
          <p>Selamat! Akun Anda telah berhasil diverifikasi dan sekarang sudah aktif. Anda bisa mulai melakukan peminjaman ruangan atau menjadwalkan tur perpustakaan.</p>
          <div style="text-align: center;"><a href="${process.env.CLIENT_URL}/dashboard" class="button">Mulai Booking</a></div>
          <p>Terima kasih telah bergabung!</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} PerpusBooking - Pustaka Wilayah Aceh</p></div>
      </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `PerpusBooking <${process.env.EMAIL_FROM}>`,
        to: user.email,
        subject: '🎉 Selamat Datang di PerpusBooking!',
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to ${user.email}`);
    } catch (error) {
        // Pengiriman email selamat datang tidak kritis, jadi kita hanya log error
        console.error('Error sending welcome email:', error);
    }
};

/**
 * Memverifikasi koneksi ke server SMTP.
 */
const testEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('Email server connection is valid and ready.');
    return true;
  } catch (error) {
    console.error('Email server connection error:', error);
    return false;
  }
};

// Ekspor semua fungsi agar bisa digunakan di bagian lain aplikasi
module.exports = {
  sendVerificationEmail,
  sendBookingNotification,
  sendTourNotification,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  testEmailConnection
};