const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { protect, rateLimiter } = require('../middleware/auth');
const { 
  sendVerificationEmail, 
  sendPasswordResetEmail, 
  sendWelcomeEmail 
} = require('../utils/email');

const router = express.Router();


// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Send token response
const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user._id);
  
  const cookieExpireDays = parseInt(process.env.JWT_EXPIRE || '7', 10);

  const options = {
    maxAge: cookieExpireDays * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure :  process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  }

  // if (process.env.NODE_ENV === 'production') {
  //   options.secure = true;
  // }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      message: statusCode === 201 ? 'User berhasil didaftarkan' : 'Login berhasil',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        originInstitution: user.originInstitution,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified
      }
    });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', rateLimiter(15 * 60 * 1000, 5), async (req, res) => {
  try {
    const { name, email, password, originInstitution, phoneNumber } = req.body;

    if (!name || !email || !password || !originInstitution || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Semua field harus diisi'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email sudah terdaftar'
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      originInstitution: originInstitution.trim(),
      phoneNumber: phoneNumber.trim()
    });

    const verificationToken = user.generateVerificationToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendVerificationEmail(user, verificationToken);
      
      // REKOMENDASI: Respons disederhanakan
      res.status(201).json({
        success: true,
        message: `Pendaftaran berhasil. Email verifikasi telah dikirim ke ${user.email}. Silakan periksa kotak masuk Anda.`
      });
    } catch (error) {
      console.error('Email sending failed:', error);
      
      await User.findByIdAndDelete(user._id);
      
      return res.status(500).json({
        success: false,
        message: 'Gagal mengirim email verifikasi. Silakan coba lagi.'
      });
    }

  } catch (error) {
    console.error('Register error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat registrasi'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', rateLimiter(15 * 60 * 1000, 10), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password harus diisi'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }
    
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: 'Akun belum diverifikasi. Silakan cek email Anda.',
        needsVerification: true,
        email: user.email
      });
    }

    sendTokenResponse(user, 200, res);

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat login'
    });
  }
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        originInstitution: user.originInstitution,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat mengambil data user'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, originInstitution, phoneNumber } = req.body;

    const fieldsToUpdate = {};
    if (name) fieldsToUpdate.name = name.trim();
    if (originInstitution) fieldsToUpdate.originInstitution = originInstitution.trim();
    if (phoneNumber) fieldsToUpdate.phoneNumber = phoneNumber.trim();

    const user = await User.findByIdAndUpdate(
      req.user.id,
      fieldsToUpdate,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile berhasil diupdate',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        originInstitution: user.originInstitution,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat update profile'
    });
  }
});

// @desc    Verify email
// @route   POST /api/auth/verify-email
// @access  Public
router.post('/verify-email', async (req, res) => {
  try {
    const { token, email } = req.body;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: 'Token dan email harus disediakan'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email: email.toLowerCase(),
      verificationToken: hashedToken,
      verificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token tidak valid atau sudah kedaluwarsa'
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    sendWelcomeEmail(user).catch(err => 
      console.error('Failed to send welcome email:', err)
    );

    sendTokenResponse(user, 200, res);

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saat verifikasi email'
    });
  }
});

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Public
router.post('/resend-verification', rateLimiter(15 * 60 * 1000, 3), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email harus disediakan' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: false });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan atau sudah diverifikasi'
      });
    }

    const verificationToken = user.generateVerificationToken();
    await user.save({ validateBeforeSave: false });

    await sendVerificationEmail(user, verificationToken);

    res.status(200).json({
      success: true,
      message: 'Email verifikasi telah dikirim ulang. Silakan cek email Anda.'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengirim ulang email verifikasi'
    });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', rateLimiter(15 * 60 * 1000, 3), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email harus disediakan' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'Jika email terdaftar, link reset password telah dikirim.'
      });
    }

    const resetToken = user.generateResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetEmail(user, resetToken);
      
      res.status(200).json({
        success: true,
        message: 'Link reset password telah dikirim ke email Anda.'
      });
    } catch (error) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Gagal mengirim email reset password'
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token, email, dan password baru harus disediakan'
      });
    }

    // REKOMENDASI: Validasi password baru
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password baru harus memiliki minimal 8 karakter'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token tidak valid atau sudah kedaluwarsa'
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);

  } catch (error) {
    console.error('Reset password error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat reset password'
    });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    message: 'Logout berhasil'
  });
});

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password lama dan password baru harus diisi'
      });
    }
    
    // REKOMENDASI: Validasi password baru
    if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password baru harus memiliki minimal 8 karakter'
        });
    }

    const user = await User.findById(req.user.id).select('+password');

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Password lama tidak sesuai'
      });
    }

    user.password = newPassword;
    await user.save();

    sendTokenResponse(user, 200, res);

  } catch (error) {
    console.error('Change password error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error saat ganti password'
    });
  }

});

module.exports = router;