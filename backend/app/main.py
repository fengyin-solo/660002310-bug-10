from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ecg_router

app = FastAPI(
    title="ECG Monitoring System API",
    description="心电 ECG 实时监测与心律失常检测系统后端服务",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ecg_router.router, prefix="/ecg", tags=["ECG"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ECG Monitoring System"}
