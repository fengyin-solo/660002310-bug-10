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

/** 一次分析的完整结果，状态栏与事件面板都从这同一份数据派生 */
export interface AnalysisResult {
  lead: ECGLead;
  hrv: HRVData;
  events: ArrhythmiaEvent[];
  diagnosis: string;
  /** 本次结果由谁计算：local 本地模拟 / backend 后端服务 */
  source: AnalysisSource;
  /** 单调递增的分析批次号，用于 v-for key 与来源标记 */
  runId: number;
}

export type AnalysisSource = 'local' | 'backend';

export interface ECGAnalysisResponse {
  lead: {
    lead_name: string;
    sampling_rate: number;
    duration: number;
    samples: number[];
    r_peaks: Array<{ index: number; time: number; amplitude: number }>;
  };
  hrv: {
    heart_rate: number;
    sdnn: number;
    rmssd: number;
    pnn50: number;
    nn_intervals: number[];
  };
  arrhythmia_events: Array<{
    event_type: ArrhythmiaEvent['eventType'];
    confidence: number;
    description: string;
    timestamp: number;
  }>;
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
