import mongoose from 'mongoose';

const CensusTractSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      match: [/^\d{11}$/, 'Census Tract GEOID must be exactly 11 digits (preserving leading zeros)']
    },
    countyFips: {
      type: String,
      required: true,
      index: true,
      match: [/^\d{5}$/, 'County FIPS must be exactly 5 digits']
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    population: {
      type: Number,
      required: true,
      min: 0
    },
    svi: {
      type: Number,
      required: true,
      min: 0,
      max: 1.0
    },
    tier: {
      type: Number,
      required: true,
      min: 0,
      max: 4 // 0: Very low, 1: Low, 2: Moderate, 3: High, 4: Very high
    },
    centroid: {
      type: [Number], // [lng, lat]
      default: [0, 0]
    },
    geometry: {
      type: mongoose.Schema.Types.Mixed, // GeoJSON or TopoJSON Polygon
      default: null
    },
    indicators: {
      type: Map,
      of: Number,
      default: {}
    },
    prog: {
      wic: { type: Number, default: 0 },
      imm: { type: Number, default: 0 },
      dpp: { type: Number, default: 0 },
      tob: { type: Number, default: 0 },
      mhv: { type: Number, default: 0 }
    },
    dataStatus: {
      type: String,
      enum: ['adequate', 'suppressed', 'unstable'],
      default: 'adequate'
    },
    flagged: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Compound index for fast tract queries within a county ordered by vulnerability
CensusTractSchema.index({ countyFips: 1, tier: -1, svi: -1 });

export const CensusTract = mongoose.model('CensusTract', CensusTractSchema);
