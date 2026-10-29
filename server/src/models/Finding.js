import mongoose from 'mongoose';

const FindingSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },
    assessmentId: {
      type: String,
      required: true,
      ref: 'Assessment',
      index: true
    },
    tractId: {
      type: String,
      required: true,
      ref: 'CensusTract',
      match: [/^\d{11}$/, 'Census Tract GEOID must be 11 digits']
    },
    tractName: {
      type: String,
      default: ''
    },
    countyLabel: {
      type: String,
      default: ''
    },
    note: {
      type: String,
      required: true,
      trim: true
    },
    snapshot: {
      svi: Number,
      tier: String,
      poverty: Number,
      uninsured: Number,
      diabetes: Number,
      access: Number,
      lifeExp: Number
    },
    addedDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10)
    }
  },
  {
    timestamps: true
  }
);

export const Finding = mongoose.model('Finding', FindingSchema);
