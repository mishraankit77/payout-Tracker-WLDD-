import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { calculatePayout, budgetCappedPayout } from './payout';

const app = express();
// Keep CORS handling first so even OPTIONS preflight and API errors carry CORS headers.
// Local development allows any localhost/127.0.0.1 port (Next.js may choose 3001+).
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true; // curl, health checks, and server-to-server requests
  if (configuredOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(isAllowedOrigin(origin) ? 204 : 403);
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ message: `CORS blocked origin: ${origin}` });
  next();
});
app.use(cors({
  origin(origin, callback) { callback(null, isAllowedOrigin(origin)); },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '1mb' }));
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-before-deploy';
type Role = 'brand' | 'creator';
interface TokenUser { id: string; role: Role; email: string; name?: string }
const auth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try { (req as any).user = jwt.verify(token, JWT_SECRET) as TokenUser; next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired token' }); }
};
const requireRole = (role: Role) => (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).user?.role !== role) return res.status(403).json({ message: `${role} role required` }); next();
};
const userSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true }, role: { type: String, enum: ['brand', 'creator'], required: true } }, { timestamps: true });
const campaignSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true }, platform: { type: String, enum: ['Instagram', 'YouTube'], required: true }, totalBudget: { type: Number, required: true, min: 1 }, spent: { type: Number, default: 0, min: 0 }, milestones: [{ views: { type: Number, required: true, min: 1 }, payout: { type: Number, required: true, min: 0 } }], brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } }, { timestamps: true });
const submissionSchema = new mongoose.Schema({ campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true }, creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, postUrl: { type: String, required: true }, views: { type: Number, default: 0, min: 0 }, payout: { type: Number, default: 0, min: 0 }, lastPaidMilestone: { type: Number, default: 0 }, viewEvents: [{ views: Number, at: Date }], flaggedSpike: { type: Boolean, default: false } }, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
const Submission = mongoose.models.Submission || mongoose.model('Submission', submissionSchema);
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'memed-api' }));
app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim(), email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || ''), role = req.body.role;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['brand', 'creator'].includes(role)) return res.status(400).json({ message: 'Enter a name, valid email, password (8+ characters), and role.' });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role });
    return res.status(201).json(makeSession(user));
  } catch (e: any) { return res.status(e.code === 11000 ? 409 : 500).json({ message: e.code === 11000 ? 'Email already registered' : 'Unable to create account' }); }
});
function makeSession(user: any) { return { token: jwt.sign({ id: user.id, name: user.name, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' }), user: { id: user.id, name: user.name, email: user.email, role: user.role } }; }
app.post('/api/auth/login', async (req, res) => {
  try { const user = await User.findOne({ email: String(req.body.email || '').trim().toLowerCase() }); if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password' }); return res.json(makeSession(user)); }
  catch { return res.status(500).json({ message: 'Unable to log in' }); }
});
app.get('/api/auth/me', auth, async (req, res) => { const u = await User.findById((req as any).user.id).select('name email role'); if (!u) return res.status(404).json({ message: 'User not found' }); res.json(u); });
app.post('/api/campaigns', auth, requireRole('brand'), async (req, res) => {
  try {
    const { name, platform, totalBudget } = req.body; let { milestones } = req.body;
    const budget = Number(totalBudget);
    if (!String(name || '').trim() || !['Instagram', 'YouTube'].includes(platform) || !Number.isFinite(budget) || budget <= 0 || !Array.isArray(milestones) || !milestones.length) return res.status(400).json({ message: 'Provide a name, platform, positive budget and at least one milestone.' });
    milestones = milestones.map((m: any) => ({ views: Number(m.views), payout: Number(m.payout) })).sort((a: any, b: any) => a.views - b.views);
    if (milestones.some((m: any) => !Number.isSafeInteger(m.views) || m.views < 1 || !Number.isFinite(m.payout) || m.payout < 0 || m.payout > budget) || new Set(milestones.map((m: any) => m.views)).size !== milestones.length || milestones.some((m: any, i: number) => i > 0 && m.payout < milestones[i - 1].payout)) return res.status(400).json({ message: 'Milestones need unique positive view thresholds and non-decreasing payouts within budget.' });
    const campaign = await Campaign.create({ name: String(name).trim(), platform, totalBudget: budget, milestones, brandId: (req as any).user.id });
    return res.status(201).json({ ...campaign.toObject(), remaining: budget, live: true });
  } catch { return res.status(500).json({ message: 'Unable to create campaign' }); }
});
app.get('/api/campaigns', auth, async (_req, res) => { try { const list = await Campaign.find().sort({ createdAt: -1 }).populate('brandId', 'name'); return res.json(list.map(c => ({ ...c.toObject(), remaining: Math.max(0, c.totalBudget - c.spent), live: c.spent < c.totalBudget }))); } catch { return res.status(500).json({ message: 'Unable to load campaigns' }); } });
app.get('/api/campaigns/mine', auth, requireRole('brand'), async (req, res) => { const list = await Campaign.find({ brandId: (req as any).user.id }).sort({ createdAt: -1 }); res.json(list.map(c => ({ ...c.toObject(), remaining: Math.max(0, c.totalBudget - c.spent), live: c.spent < c.totalBudget }))); });
app.post('/api/campaigns/:id/submissions', auth, requireRole('creator'), async (req, res) => {
  try { const url = String(req.body.postUrl || '').trim(); if (!/^https?:\/\//i.test(url)) return res.status(400).json({ message: 'Enter a valid http(s) post URL.' }); const campaign = await Campaign.findById(req.params.id); if (!campaign || campaign.spent >= campaign.totalBudget) return res.status(400).json({ message: 'Campaign is not available for submissions.' }); const submission = await Submission.create({ campaignId: campaign.id, creatorId: (req as any).user.id, postUrl: url }); return res.status(201).json(submission); }
  catch { return res.status(500).json({ message: 'Unable to submit post' }); }
});
app.get('/api/submissions/mine', auth, requireRole('creator'), async (req, res) => { try { res.json(await Submission.find({ creatorId: (req as any).user.id }).populate('campaignId', 'name platform totalBudget').sort({ createdAt: -1 })); } catch { res.status(500).json({ message: 'Unable to load submissions' }); } });
app.get('/api/earnings', auth, requireRole('creator'), async (req, res) => { const result = await Submission.aggregate([{ $match: { creatorId: new mongoose.Types.ObjectId((req as any).user.id) } }, { $group: { _id: null, total: { $sum: '$payout' }, submissions: { $sum: 1 } } }]); res.json(result[0] ? { total: result[0].total, submissions: result[0].submissions } : { total: 0, submissions: 0 }); });
// Simulates platform view sync. Payouts are incremental and always budget-capped.
app.patch('/api/submissions/:id/views', async (req, res) => {
  const views = Number(req.body.views);
  if (!Number.isSafeInteger(views) || views < 0) return res.status(400).json({ message: 'Views must be a non-negative whole number.' });
  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const submission = await Submission.findById(req.params.id).session(session);
      if (!submission) throw Object.assign(new Error('Submission not found'), { status: 404 });
      const campaign = await Campaign.findById(submission.campaignId).session(session);
      if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
      const target = calculatePayout(views, campaign.milestones);
      const remaining = Math.max(0, campaign.totalBudget - campaign.spent);
      const payment = budgetCappedPayout(target, submission.payout, remaining);
      // Conditional write is the final guard against overspending, including concurrent updates.
      if (payment > 0) {
        const claimed = await Campaign.findOneAndUpdate({ _id: campaign._id, $expr: { $lte: [{ $add: ['$spent', payment] }, '$totalBudget'] } }, { $inc: { spent: payment } }, { new: true, session });
        if (!claimed) throw Object.assign(new Error('Budget changed during update; retry the request.'), { status: 409 });
      }
      const now = new Date(); const recent = (submission.viewEvents || []).filter((e: any) => now.getTime() - new Date(e.at).getTime() < 60 * 60 * 1000);
      const previous = recent.length ? Math.min(...recent.map((e: any) => e.views)) : submission.views;
      const spike = views >= 1000 && views - previous >= Math.max(1000, previous * 3);
      submission.views = views; submission.payout += payment; submission.lastPaidMilestone = target <= submission.payout ? target : submission.lastPaidMilestone;
      submission.flaggedSpike = submission.flaggedSpike || spike;
      submission.viewEvents = [...recent, { views, at: now }].slice(-10) as any;
      await submission.save({ session }); result = submission;
    });
    return res.json(result);
  } catch (e: any) { return res.status(e.status || 500).json({ message: e.status ? e.message : 'Unable to update views. MongoDB transactions require a replica set (MongoDB Atlas works).' }); }
  finally { await session.endSession(); }
});
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => { console.error(err); res.status(500).json({ message: 'Unexpected server error' }); });
export async function start() { if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required'); await mongoose.connect(process.env.MONGODB_URI); const port = Number(process.env.PORT || 4000); app.listen(port, '0.0.0.0', () => console.log(`Meme’d API listening on http://localhost:${port}; allowed local origins include localhost:3000, :3001, and other localhost ports`)); }
if (process.env.NODE_ENV !== 'test') start().catch(err => { console.error('Backend startup failed:', err.message); process.exit(1); });
export default app;
