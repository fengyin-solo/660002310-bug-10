import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  ECGLead,
  HRVData,
  RPeak,
  ArrhythmiaEvent,
  AnalysisResult,
  AnalysisSource,
  ECGAnalysisResponse,
} from '../types';

// Gaussian function for PQRST wave simulation
function gaussian(x: number, amplitude: number, center: number, width: number): number {
  return amplitude * Math.exp(-((x - center) ** 2) / (2 * width ** 2));
}

// Lead-specific PQRST configuration
interface LeadConfig {
  pAmplitude: number;
  qAmplitude: number;
  rAmplitude: number;
  sAmplitude: number;
  tAmplitude: number;
  stElevation: number;
}

const LEAD_CONFIGS: Record<string, LeadConfig> = {
  'I': { pAmplitude: 0.12, qAmplitude: -0.05, rAmplitude: 0.8, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
  'II': { pAmplitude: 0.15, qAmplitude: -0.1, rAmplitude: 1.2, sAmplitude: -0.2, tAmplitude: 0.3, stElevation: 0.0 },
  'III': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.15, tAmplitude: 0.2, stElevation: 0.0 },
  'aVR': { pAmplitude: -0.10, qAmplitude: 0.05, rAmplitude: -0.8, sAmplitude: 0.1, tAmplitude: -0.2, stElevation: 0.0 },
  'aVL': { pAmplitude: 0.10, qAmplitude: -0.03, rAmplitude: 0.6, sAmplitude: -0.05, tAmplitude: 0.2, stElevation: 0.0 },
  'aVF': { pAmplitude: 0.13, qAmplitude: -0.09, rAmplitude: 1.0, sAmplitude: -0.18, tAmplitude: 0.28, stElevation: 0.0 },
  'V1': { pAmplitude: 0.08, qAmplitude: 0.0, rAmplitude: 0.3, sAmplitude: -0.8, tAmplitude: 0.15, stElevation: 0.0 },
  'V2': { pAmplitude: 0.10, qAmplitude: -0.02, rAmplitude: 0.6, sAmplitude: -0.6, tAmplitude: 0.25, stElevation: 0.0 },
  'V3': { pAmplitude: 0.10, qAmplitude: -0.05, rAmplitude: 0.9, sAmplitude: -0.4, tAmplitude: 0.3, stElevation: 0.0 },
  'V4': { pAmplitude: 0.12, qAmplitude: -0.08, rAmplitude: 1.3, sAmplitude: -0.25, tAmplitude: 0.35, stElevation: 0.0 },
  'V5': { pAmplitude: 0.12, qAmplitude: -0.1, rAmplitude: 1.1, sAmplitude: -0.15, tAmplitude: 0.3, stElevation: 0.0 },
  'V6': { pAmplitude: 0.10, qAmplitude: -0.08, rAmplitude: 0.9, sAmplitude: -0.1, tAmplitude: 0.25, stElevation: 0.0 },
};

// Generate a single PQRST cycle at normalized time t (0 to 1)
function generatePQRSTCycle(tNorm: number, config: LeadConfig): number {
  const p = gaussian(tNorm, config.pAmplitude, 0.12, 0.035);
  const q = gaussian(tNorm, config.qAmplitude, 0.22, 0.012);
  const r = gaussian(tNorm, config.rAmplitude, 0.26, 0.012);
  const s = gaussian(tNorm, config.sAmplitude, 0.30, 0.015);
  const tWave = gaussian(tNorm, config.tAmplitude, 0.48, 0.055);
  const st = (tNorm > 0.32 && tNorm < 0.42) ? config.stElevation : 0.0;
  return p + q + r + s + tWave + st;
}

/** 心率滑条停止拖动后多久才发起一次分析 */
const HEART_RATE_DEBOUNCE_MS = 400;
/** 后端请求超时时间 */
const BACKEND_TIMEOUT_MS = 8000;

/**
 * 由同一份事件列表派生统一的诊断文案。
 * 状态栏与事件面板都以此为准，保证两处口径一致。
 */
function buildDiagnosis(events: ArrhythmiaEvent[], hrv: HRVData): string {
  const types = new Set(events.map((e) => e.eventType));

  if (types.has('st_elevation')) return 'ST 段抬高 - 建议立即就医检查';
  if (types.has('tachycardia') && types.has('atrial_fibrillation')) return '快速房颤 - 建议进一步心脏评估';
  if (types.has('tachycardia')) return '窦性心动过速 - 请结合临床症状判断';
  if (types.has('bradycardia')) return '窦性心动过缓 - 建议关注心率变化';
  if (types.has('atrial_fibrillation')) return '心律不规则 - 疑似房颤，建议 Holter 监测';

  const pvc = events.find((e) => e.eventType === 'premature_ventricular_contraction');
  if (pvc) return pvc.description;

  return `正常窦性心律 | HR: ${hrv.heartRate.toFixed(0)} BPM | SDNN: ${hrv.sdnn.toFixed(1)} ms`;
}

export const useECGStore = defineStore('ecg', () => {
  // State
  const selectedLead = ref<string>('II');
  const heartRate = ref<number>(72);
  const samplingRate = ref<number>(500);
  const duration = ref<number>(10);
  const isMonitoring = ref<boolean>(false);
  const ecgData = ref<ECGLead | null>(null);
  const hrvData = ref<HRVData | null>(null);
  const arrhythmiaEvents = ref<ArrhythmiaEvent[]>([]);
  const rhythmDiagnosis = ref<string>('');
  const isLoading = ref<boolean>(false);
  const useBackend = ref<boolean>(false);
  const backendUrl = ref<string>('http://localhost:8000');
  /** 当前页面上这份结果的计算来源（本地 / 后端），null 表示尚未分析 */
  const analysisSource = ref<AnalysisSource | null>(null);
  /** 最近一次成功提交的分析批次号，用于列表 key */
  const lastRunId = ref<number>(0);
  /** 后端不可用时的错误信息；非空时界面弹窗展示 */
  const backendError = ref<string | null>(null);

  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let scrollOffset = ref<number>(0);

  // 并发控制：单调递增的分析批次号，只有最新一轮允许提交结果
  let runSeq = 0;
  // 当前在飞的后端请求，可在新一轮分析开始时中止
  let activeController: AbortController | null = null;
  // 心率滑条的防抖计时器
  let hrDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Getters
  const currentSamples = computed(() => ecgData.value?.samples ?? []);
  const currentRPeaks = computed(() => ecgData.value?.rPeaks ?? []);
  const currentHeartRate = computed(() => hrvData.value?.heartRate ?? heartRate.value);

  // Actions

  /**
   * Generate realistic 12-lead ECG waveform data with PQRST morphology
   */
  function generateECGWaveform(): ECGLead {
    const totalSamples = Math.floor(duration.value * samplingRate.value);
    const samples: number[] = new Array(totalSamples);
    const config = LEAD_CONFIGS[selectedLead.value] || LEAD_CONFIGS['II'];
    const cycleDuration = 60.0 / heartRate.value;

    for (let i = 0; i < totalSamples; i++) {
      const time = i / samplingRate.value;
      const cyclePosition = (time % cycleDuration) / cycleDuration;

      // Add slight HRV variation per beat
      const beatIndex = Math.floor(time / cycleDuration);
      const hrvFactor = 1.0 + Math.sin(beatIndex * 0.7) * 0.02;

      samples[i] = generatePQRSTCycle(cyclePosition, config) * hrvFactor;

      // Add baseline wander
      samples[i] += 0.03 * Math.sin(2 * Math.PI * 0.15 * time);
      // Add small noise
      samples[i] += (Math.random() - 0.5) * 0.02;
    }

    return {
      leadName: selectedLead.value,
      samplingRate: samplingRate.value,
      duration: duration.value,
      samples,
      rPeaks: [],
    };
  }

  /**
   * Pan-Tompkins R-peak detection algorithm
   * Simplified implementation: bandpass -> differentiate -> square -> integrate -> threshold
   */
  function detectRPeaks(samples: number[], sr: number): RPeak[] {
    const rPeaks: RPeak[] = [];
    const minDistance = Math.floor(0.2 * sr); // 200ms minimum between peaks

    // Simple moving average for baseline
    const threshold = samples.reduce((a, b) => a + b, 0) / samples.length;
    const stdDev = Math.sqrt(
      samples.reduce((sum, s) => sum + (s - threshold) ** 2, 0) / samples.length
    );
    const detectionThreshold = threshold + 0.5 * stdDev;

    let lastPeakIndex = -minDistance;

    for (let i = 1; i < samples.length - 1; i++) {
      if (
        samples[i] > detectionThreshold &&
        samples[i] > samples[i - 1] &&
        samples[i] > samples[i + 1] &&
        i - lastPeakIndex >= minDistance
      ) {
        // Find local maximum in a small window
        let maxVal = samples[i];
        let maxIdx = i;
        const searchRadius = Math.floor(0.01 * sr);
        for (let j = Math.max(0, i - searchRadius); j < Math.min(samples.length, i + searchRadius); j++) {
          if (samples[j] > maxVal) {
            maxVal = samples[j];
            maxIdx = j;
          }
        }

        rPeaks.push({
          index: maxIdx,
          time: maxIdx / sr,
          amplitude: maxVal,
        });
        lastPeakIndex = i;
      }
    }

    return rPeaks;
  }

  /**
   * Calculate HRV metrics from R-peak positions
   * SDNN, RMSSD, pNN50
   */
  function calculateHRV(rPeaks: RPeak[], sr: number): HRVData {
    if (rPeaks.length < 3) {
      return { heartRate: heartRate.value, sdnn: 0, rmssd: 0, pnn50: 0, nnIntervals: [] };
    }

    const nnIntervals: number[] = [];
    for (let i = 1; i < rPeaks.length; i++) {
      const rr = ((rPeaks[i].index - rPeaks[i - 1].index) / sr) * 1000;
      nnIntervals.push(rr);
    }

    const meanRR = nnIntervals.reduce((a, b) => a + b, 0) / nnIntervals.length;
    const hr = meanRR > 0 ? 60000 / meanRR : 0;

    // SDNN
    const variance = nnIntervals.reduce((sum, x) => sum + (x - meanRR) ** 2, 0) / nnIntervals.length;
    const sdnn = Math.sqrt(variance);

    // RMSSD
    let sumSquaredDiffs = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      sumSquaredDiffs += (nnIntervals[i] - nnIntervals[i - 1]) ** 2;
    }
    const rmssd = Math.sqrt(sumSquaredDiffs / (nnIntervals.length - 1));

    // pNN50
    let nn50Count = 0;
    for (let i = 1; i < nnIntervals.length; i++) {
      if (Math.abs(nnIntervals[i] - nnIntervals[i - 1]) > 50) {
        nn50Count++;
      }
    }
    const pnn50 = (nn50Count / (nnIntervals.length - 1)) * 100;

    return {
      heartRate: Math.round(hr * 10) / 10,
      sdnn: Math.round(sdnn * 100) / 100,
      rmssd: Math.round(rmssd * 100) / 100,
      pnn50: Math.round(pnn50 * 100) / 100,
      nnIntervals,
    };
  }

  /**
   * Arrhythmia detection: tachycardia, bradycardia, ST-elevation
   */
  function detectArrhythmias(hrv: HRVData, rPeaks: RPeak[], samples: number[], sr: number): ArrhythmiaEvent[] {
    const events: ArrhythmiaEvent[] = [];
    const hr = hrv.heartRate;

    if (hr > 100) {
      events.push({
        eventType: 'tachycardia',
        confidence: Math.min(1.0, (hr - 100) / 50 + 0.6),
        description: `心率过快 (${hr.toFixed(0)} BPM)，检测到心动过速`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    if (hr < 60 && hr > 0) {
      events.push({
        eventType: 'bradycardia',
        confidence: Math.min(1.0, (60 - hr) / 30 + 0.6),
        description: `心率过慢 (${hr.toFixed(0)} BPM)，检测到心动过缓`,
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    // ST-segment elevation detection
    let stElevationCount = 0;
    for (const rp of rPeaks) {
      const stStart = rp.index + Math.floor(0.08 * sr);
      const stEnd = rp.index + Math.floor(0.12 * sr);
      if (stEnd < samples.length) {
        const stLevel = samples.slice(stStart, stEnd).reduce((a, b) => a + b, 0) / (stEnd - stStart);
        const blStart = Math.max(0, rp.index - Math.floor(0.2 * sr));
        const baseline = samples.slice(blStart, rp.index).reduce((a, b) => a + b, 0) / (rp.index - blStart);
        if (stLevel - baseline > 0.1) {
          stElevationCount++;
        }
      }
    }
    if (stElevationCount > rPeaks.length * 0.5) {
      events.push({
        eventType: 'st_elevation',
        confidence: Math.min(1.0, stElevationCount / Math.max(1, rPeaks.length)),
        description: '检测到 ST 段抬高，可能提示心肌梗死',
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    if (events.length === 0) {
      events.push({
        eventType: 'normal',
        confidence: 1.0,
        description: '正常窦性心律',
        timestamp: rPeaks[0]?.time ?? 0,
      });
    }

    return events;
  }

  /**
   * 本地完整分析（前端模拟），产出一份原子结果
   */
  function runLocalAnalysis(runId: number): AnalysisResult {
    const lead = generateECGWaveform();
    lead.rPeaks = detectRPeaks(lead.samples, lead.samplingRate);

    const hrv = calculateHRV(lead.rPeaks, lead.samplingRate);
    const events = detectArrhythmias(hrv, lead.rPeaks, lead.samples, lead.samplingRate);

    return {
      lead,
      hrv,
      events,
      diagnosis: buildDiagnosis(events, hrv),
      source: 'local',
      runId,
    };
  }

  /**
   * 调用后端 /ecg/analyze，带超时；网络错误 / 非 2xx / 超时都会抛出
   */
  async function requestBackendAnalysis(signal: AbortSignal): Promise<ECGAnalysisResponse> {
    const timeoutController = new AbortController();
    const onAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, BACKEND_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${backendUrl.value}/ecg/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_name: selectedLead.value,
          duration: duration.value,
          sampling_rate: samplingRate.value,
          heart_rate: heartRate.value,
        }),
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`请求超时（${BACKEND_TIMEOUT_MS / 1000}s 无响应），服务可能已启动但响应过慢或地址不可达`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    if (!response.ok) {
      throw new Error(`服务返回异常：HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    return (await response.json()) as ECGAnalysisResponse;
  }

  function mapBackendResult(data: ECGAnalysisResponse, runId: number): AnalysisResult {
    return {
      lead: {
        leadName: data.lead.lead_name,
        samplingRate: data.lead.sampling_rate,
        duration: data.lead.duration,
        samples: data.lead.samples,
        rPeaks: data.lead.r_peaks.map((rp) => ({
          index: rp.index,
          time: rp.time,
          amplitude: rp.amplitude,
        })),
      },
      hrv: {
        heartRate: data.hrv.heart_rate,
        sdnn: data.hrv.sdnn,
        rmssd: data.hrv.rmssd,
        pnn50: data.hrv.pnn50,
        nnIntervals: data.hrv.nn_intervals,
      },
      events: data.arrhythmia_events.map((evt) => ({
        eventType: evt.event_type,
        confidence: evt.confidence,
        description: evt.description,
        timestamp: evt.timestamp,
      })),
      diagnosis: data.rhythm_diagnosis,
      source: 'backend',
      runId,
    };
  }

  /**
   * 原子提交：波形 / HRV / 事件 / 诊断 / 来源一次性来自同一轮结果，
   * 杜绝晚到的响应分多次覆盖，保证状态栏与事件面板同源。
   */
  function commitResult(result: AnalysisResult) {
    ecgData.value = result.lead;
    hrvData.value = result.hrv;
    arrhythmiaEvents.value = result.events;
    rhythmDiagnosis.value = result.diagnosis;
    analysisSource.value = result.source;
    lastRunId.value = result.runId;
    backendError.value = null;
  }

  function formatBackendError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `无法连接后端分析服务（${backendUrl.value}）。\n请确认 FastAPI 服务已启动、地址与端口正确，或改用本地分析。\n\n技术信息：${detail}`;
  }

  function cancelHeartRateDebounce() {
    if (hrDebounceTimer) {
      clearTimeout(hrDebounceTimer);
      hrDebounceTimer = null;
    }
  }

  /**
   * Run full ECG analysis.
   * 单飞 + 最新生效：每发起一次就作废旧一轮（中止其在飞请求），
   * 只有最新一轮的结果允许提交。后端不可用时不静默降级，弹窗报错。
   */
  async function analyzeECG(): Promise<void> {
    cancelHeartRateDebounce();

    const runId = ++runSeq;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    isLoading.value = true;

    const isStale = () => runSeq !== runId;

    try {
      if (useBackend.value) {
        let data: ECGAnalysisResponse;
        try {
          data = await requestBackendAnalysis(controller.signal);
        } catch (error) {
          // 被更新的一轮取代：静默丢弃
          if (isStale() || controller.signal.aborted) return;
          backendError.value = formatBackendError(error);
          return;
        }
        if (isStale()) return;
        commitResult(mapBackendResult(data, runId));
      } else {
        const result = runLocalAnalysis(runId);
        if (isStale()) return;
        commitResult(result);
      }
    } finally {
      if (!isStale()) {
        isLoading.value = false;
        activeController = null;
      }
    }
  }

  /**
   * Start real-time monitoring simulation
   */
  function startMonitoring() {
    isMonitoring.value = true;
    analyzeECG();
    animationTimer = setInterval(() => {
      scrollOffset.value += 5;
      // Regenerate data every full cycle；ecgData 尚未就绪时等待首轮结果，避免空转连发
      const totalLength = ecgData.value?.samples.length ?? 0;
      if (totalLength > 0 && scrollOffset.value >= totalLength) {
        scrollOffset.value = 0;
        analyzeECG();
      }
    }, 50);
  }

  /**
   * Stop monitoring
   */
  function stopMonitoring() {
    isMonitoring.value = false;
    cancelHeartRateDebounce();
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
  }

  /**
   * Select a different ECG lead
   */
  function selectLead(lead: string) {
    if (selectedLead.value === lead) return;
    selectedLead.value = lead;
    if (isMonitoring.value) {
      analyzeECG();
    }
  }

  /**
   * Update heart rate setting.
   * 监测中拖动滑条只更新数值，停下（400ms 内无新输入）后只分析一次。
   */
  function setHeartRate(hr: number) {
    heartRate.value = hr;
    if (!isMonitoring.value) return;

    cancelHeartRateDebounce();
    hrDebounceTimer = setTimeout(() => {
      hrDebounceTimer = null;
      if (isMonitoring.value) {
        analyzeECG();
      }
    }, HEART_RATE_DEBOUNCE_MS);
  }

  /**
   * 切换“使用后端 API”。打开后立即按后端口径分析一次；
   * 连不上则弹窗（不会静默用本地结果冒充后端结果），开关保持用户选择。
   */
  async function setUseBackend(enabled: boolean) {
    if (useBackend.value === enabled) return;
    useBackend.value = enabled;
    if (isMonitoring.value || ecgData.value) {
      await analyzeECG();
    }
  }

  /** 关闭后端错误弹窗（保留当前页面上已有的分析结果与开关状态） */
  function dismissBackendError() {
    backendError.value = null;
  }

  /** 弹窗入口：重试后端分析 */
  async function retryBackendAnalysis(): Promise<void> {
    backendError.value = null;
    await analyzeECG();
  }

  /** 弹窗入口：本次改用本地分析，并把开关切回本地侧 */
  async function analyzeLocallyAfterError(): Promise<void> {
    backendError.value = null;
    useBackend.value = false;
    await analyzeECG();
  }

  return {
    // State
    selectedLead,
    heartRate,
    samplingRate,
    duration,
    isMonitoring,
    ecgData,
    hrvData,
    arrhythmiaEvents,
    rhythmDiagnosis,
    isLoading,
    useBackend,
    backendUrl,
    scrollOffset,
    analysisSource,
    lastRunId,
    backendError,
    // Getters
    currentSamples,
    currentRPeaks,
    currentHeartRate,
    // Actions
    analyzeECG,
    startMonitoring,
    stopMonitoring,
    selectLead,
    setHeartRate,
    setUseBackend,
    dismissBackendError,
    retryBackendAnalysis,
    analyzeLocallyAfterError,
    generateECGWaveform,
    detectRPeaks,
    calculateHRV,
    detectArrhythmias,
  };
});
