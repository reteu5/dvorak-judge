from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os, json, redis, uuid, glob

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
ALLOW_ORIGIN = os.getenv("ALLOW_ORIGIN", "http://localhost:3000")
r = redis.from_url(REDIS_URL, decode_responses=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOW_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def list_problem_files():
    return glob.glob(os.path.join("problems", "*.json"))

def load_problem(problem_id: str):
    path = os.path.join("problems", f"{problem_id}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "problem not found")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.get("/problems")
def problems():
    out = []
    for p in list_problem_files():
        with open(p, "r", encoding="utf-8") as f:
            j = json.load(f)
            out.append({"id": j["id"], "title": j["title"], "languages": ["python","cpp"]})
    return out

@app.get("/problems/{problem_id}")
def problem_detail(problem_id: str):
    prob = load_problem(problem_id)
    return {
        "id": prob["id"],
        "title": prob["title"],
        "description": prob.get("description", ""),
        "time_limit_ms": prob.get("time_limit_ms", 2000),
        "memory_limit_mb": prob.get("memory_limit_mb", 256),
    }

class Submission(BaseModel):
    problem_id: str
    language: str
    code: str

@app.post("/submit")
def submit(s: Submission):
    _ = load_problem(s.problem_id)  # 존재 검증
    job_id = str(uuid.uuid4())
    job = {"type": "judge", "job_id": job_id, "payload": s.model_dump()}
    r.lpush("judge:queue", json.dumps(job))
    # 결과 TTL은 워커에서 setex로 설정
    return {"ok": True, "job_id": job_id}

@app.get("/result/{job_id}")
def result(job_id: str):
    key = f"result:{job_id}"
    val = r.get(key)
    if not val:
        return {"done": False}
    return {"done": True, "result": json.loads(val)}

@app.get("/health")
def health():
    try:
        r.ping()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "err": str(e)}
