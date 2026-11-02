import express from 'express';
import crypto from 'crypto';
import { User } from '../models/User.js';

const router = express.Router();

export const LOGIN_ROLES = {
  analyst: {
    roleName: 'Public Health Analyst',
    organization: 'County Health Department',
    avatar: 'PA'
  },
  manager: {
    roleName: 'Program Manager',
    organization: 'City Health Department',
    avatar: 'PM'
  },
  admin: {
    roleName: 'Data Administrator',
    organization: 'Health Data Team',
    avatar: 'DA'
  }
};

export function createAuthToken(user) {
  const secret = process.env.JWT_SECRET || 'mapwell-secret-health-token-key-2026';
  const payload = {
    id: String(user._id),
    email: user.email,
    role: user.role || 'analyst',
    roleName: user.roleName || 'Public Health Analyst',
    organization: user.organization || 'County Health Department',
    avatar: user.avatar || 'PA',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };
  const str = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(str).digest('base64url');
  return `${str}.${signature}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [str, sig] = parts;
  const secret = process.env.JWT_SECRET || 'mapwell-secret-health-token-key-2026';
  const expectedSig = crypto.createHmac('sha256', secret).update(str).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * POST /api/auth/login
 * Validates credentials against MongoDB and issues auth token
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, role = 'analyst' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password. Please verify your credentials.' });
    }

    const isValid = user.verifyPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password. Please verify your credentials.' });
    }

    // Apply role metadata if role changed or user has selection
    const roleMeta = LOGIN_ROLES[role] || LOGIN_ROLES.analyst;
    user.role = role;
    user.roleName = roleMeta.roleName;
    user.organization = roleMeta.organization;
    user.avatar = roleMeta.avatar;
    user.lastLogin = new Date();
    await user.save();

    const token = createAuthToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        organization: user.organization,
        avatar: user.avatar
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/google
 * Authenticates or registers via Google Single Sign-On
 */
router.post('/google', async (req, res, next) => {
  try {
    const { email, name, googleId, picture, role = 'analyst' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Google email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: cleanEmail });
    const roleMeta = LOGIN_ROLES[role] || LOGIN_ROLES.analyst;

    if (!user) {
      // Create user account for Google SSO
      const { salt, hash } = User.hashPassword(crypto.randomBytes(32).toString('hex'));
      user = new User({
        email: cleanEmail,
        passwordHash: hash,
        salt,
        googleId: googleId || `google-${Date.now()}`,
        role,
        roleName: roleMeta.roleName,
        organization: roleMeta.organization,
        avatar: roleMeta.avatar,
        lastLogin: new Date()
      });
      await user.save();
    } else {
      user.role = role;
      user.roleName = roleMeta.roleName;
      user.organization = roleMeta.organization;
      user.avatar = roleMeta.avatar;
      if (googleId) user.googleId = googleId;
      user.lastLogin = new Date();
      await user.save();
    }

    const token = createAuthToken(user);

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        organization: user.organization,
        avatar: user.avatar
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Retrieves authenticated user details from session token
 */
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided.' });
    }

    const decoded = verifyAuthToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Session expired or invalid token.' });
    }

    const user = await User.findById(decoded.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        roleName: user.roleName,
        organization: user.organization,
        avatar: user.avatar
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

export default router;
