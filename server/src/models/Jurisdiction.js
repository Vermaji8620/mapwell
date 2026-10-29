import mongoose from 'mongoose';

const JurisdictionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      match: [/^\d{5}$/, 'County FIPS must be exactly 5 digits (preserving leading zeros)']
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    stateFips: {
      type: String,
      required: true,
      match: [/^\d{2}$/, 'State FIPS must be exactly 2 digits']
    },
    stateName: {
      type: String,
      required: true
    },
    stateAbbr: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 2,
      maxlength: 2
    },
    region: {
      type: String,
      required: true,
      enum: ['Northeast', 'Midwest', 'South', 'West']
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
    centroid: {
      type: [Number], // [lng, lat]
      required: true
    },
    bbox: {
      type: [Number], // [minLng, minLat, maxLng, maxLat]
      default: []
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
    completenessScore: {
      type: Number,
      default: 95.0,
      min: 0,
      max: 100
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

JurisdictionSchema.virtual('label').get(function () {
  return `${this.name}, ${this.stateAbbr}`;
});

export const Jurisdiction = mongoose.model('Jurisdiction', JurisdictionSchema);
