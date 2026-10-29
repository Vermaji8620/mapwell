import mongoose from 'mongoose';

const UserSessionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: 'default-analyst'
    },
    activeJurisdiction: {
      type: String,
      default: '53033', // Default King County, WA
      ref: 'Jurisdiction'
    },
    activeLayer: {
      type: String,
      default: 'sdoh'
    },
    activeMetric: {
      type: String,
      default: 'sdoh'
    },
    compareTracts: {
      type: [String],
      validate: [val => val.length <= 4, 'Cannot compare more than 4 tracts simultaneously'],
      default: []
    },
    flaggedTracts: {
      type: [String],
      default: []
    },
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light'
    },
    trendWindowYears: {
      type: Number,
      enum: [3, 5, 10],
      default: 10
    },
    workflowMilestones: {
      type: Map,
      of: Boolean,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const UserSession = mongoose.model('UserSession', UserSessionSchema);
