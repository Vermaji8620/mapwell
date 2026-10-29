import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['Vulnerability brief', 'Program review', 'Assessment summary'],
      default: 'Vulnerability brief'
    },
    fromAssessmentId: {
      type: String,
      default: null,
      ref: 'Assessment'
    },
    jurisdictionId: {
      type: String,
      required: true,
      ref: 'Jurisdiction'
    },
    primaryMetric: {
      type: String,
      default: 'svi'
    },
    status: {
      type: String,
      enum: ['Draft', 'Published'],
      default: 'Draft'
    },
    focusTracts: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    findingsSnapshot: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    methodNote: {
      type: String,
      default: 'Census tract boundaries and indicators are derived from public health feeds (CDC PLACES and US Census Bureau ACS 5-year estimates).'
    }
  },
  {
    timestamps: true
  }
);

ReportSchema.index({ jurisdictionId: 1, status: 1 });

export const Report = mongoose.model('Report', ReportSchema);
