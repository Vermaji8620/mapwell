import mongoose from 'mongoose';

// DataSource Model
const DataSourceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. 'census', 'tiles', 'chronic', 'programs'
    name: { type: String, required: true },
    icon: { type: String, default: 'cloud' },
    status: { type: String, enum: ['ok', 'warn', 'bad'], default: 'ok' },
    desc: { type: String, default: '' },
    meta: { type: [[String]], default: [] }, // Array of [key, value] pairs
    lastSync: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const DataSource = mongoose.model('DataSource', DataSourceSchema);

// ImportLog Model
const ImportLogSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. 'IMP-3391'
    name: { type: String, required: true },
    src: { type: String, required: true },
    rows: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Completed', 'Completed with warnings', 'Failed', 'In progress'],
      default: 'Completed'
    },
    duration: { type: String, default: '0m 15s' },
    startedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const ImportLog = mongoose.model('ImportLog', ImportLogSchema);

// ProcessingError Model
const ProcessingErrorSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. 'E-551'
    dataset: { type: String, required: true },
    msg: { type: String, required: true },
    severity: { type: String, enum: ['warn', 'bad'], default: 'bad' },
    open: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const ProcessingError = mongoose.model('ProcessingError', ProcessingErrorSchema);
