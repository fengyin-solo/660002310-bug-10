export interface ECGLead {
  leadName: string;
  samplingRate: number;
  duration: number;
  samples: number[];
  rPeaks: RPeak[];
}

export interface RPeak {
  index: number;
  time: number;
  amplitude: number;
}

export interface HRVData {
  heartRate: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  nnIntervals: number[];
}

export interface ArrhythmiaEvent {
  eventType: 'normal' | 'tachycardia' | 'bradycardia' | 'st_elevation' | 'atrial_fibrillation' | 'premature_ventricular_contraction';
  confidence: number;
  description: string;
  timestamp: number;
}

// ---- Backend API wire format (FastAPI returns snake_case JSON) ----

export interface ApiRPeak {
  index: number;
  time: number;
  amplitude: number;
}

export interface ApiECGLead {
  lead_name: string;
  sampling_rate: number;
  duration: number;
  samples: number[];
  r_peaks: ApiRPeak[];
}

export interface ApiHRVMetrics {
  heart_rate: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  nn_intervals: number[];
}

export interface ApiArrhythmiaEvent {
  event_type: ArrhythmiaEvent['eventType'];
  confidence: number;
  description: string;
  timestamp: number;
}

export interface ECGAnalysisResponse {
  lead: ApiECGLead;
  hrv: ApiHRVMetrics;
  arrhythmia_events: ApiArrhythmiaEvent[];
  rhythm_diagnosis: string;
}

export interface ECGAnalysisRequest {
  leadName: string;
  duration: number;
  samplingRate: number;
  heartRate: number;
}

export const LEAD_NAMES: string[] = [
  'I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'
];
