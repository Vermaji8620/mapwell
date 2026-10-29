import mongoose from 'mongoose';

const AssessmentSchema = new mongoose.Schema(
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
    jurisdictionId: {
      type: String,
      required: true,
      ref: 'Jurisdiction'
    },
    status: {
      type: String,
      enum: ['Draft', 'In review', 'Completed', 'Published'],
      default: 'Draft'
    },
    step: {
      type: Number,
      min: 1,
      max: 5,
      default: 1
    },
    indicators: {
      type: [String],
      default: ['svi', 'poverty', 'uninsured', 'diabetes']
    },
    focusTracts: {
      type: [String],
      default: []
    },
    owner: {
      type: String,
      default: 'Public Health Analyst'
    },
    due: {
      type: String,
      default: ''
    },
    template: {
      type: String,
      enum: ['chronic', 'mch', 'access', 'custom'],
      default: 'custom'
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

AssessmentSchema.index({ jurisdictionId: 1, status: 1 });

export const Assessment = mongoose.model('Assessment', AssessmentSchema);
