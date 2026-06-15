# 心电 ECG 实时监测与心律失常检测系统

一个基于 Vue 3 + FastAPI 的心电图 (ECG) 实时监测与心律失常检测系统，支持 12 导联心电信号模拟、Pan-Tompkins R 峰值检测、心率变异性 (HRV) 分析及心律失常自动检测。

## 功能特性

### 心电信号生成
- 基于高斯函数的 PQRST 波形形态模拟，生成逼真的 12 导联心电图信号
- 支持 I, II, III, aVR, aVL, aVF, V1-V6 全部 12 导联
- 可调节心率 (30-180 BPM) 和记录时长 (5-30s)
- 包含基线漂移和高频噪声模拟真实采集环境

### R 峰值检测
- 采用 Pan-Tompkins 算法进行 QRS 波群检测
- 带通滤波 (5-15 Hz) → 微分 → 平方 → 滑动窗口积分 → 自适应阈值
- 准确的 R 峰值定位与标注

### 心率变异性分析 (HRV)
- 心率 (HR) 实时计算
- SDNN：所有 NN 间期的标准差
- RMSSD：相邻 NN 间期差值的均方根
- pNN50：相邻 RR 差值 > 50ms 的百分比
- RR 间期图 (Tachogram) 可视化

### 心律失常检测
- 心动过速检测 (HR > 100 BPM)
- 心动过缓检测 (HR < 60 BPM)
- ST 段抬高检测（提示心肌梗死可能）
- 心律不规则检测（疑似房颤）
- 置信度评分与中文诊断描述

## 技术栈

### 前端
- Vue 3 + TypeScript + Vite
- Pinia 状态管理
- ECharts + vue-echarts 数据可视化
- Tailwind CSS 样式
- Axios HTTP 客户端

### 后端
- Python FastAPI
- NumPy 数值计算
- SciPy 信号处理
- Pydantic 数据模型

## 快速开始

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

### 后端启动

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端默认在 `http://localhost:5173` 运行，可通过侧边栏"使用后端 API"开关连接后端分析服务。
