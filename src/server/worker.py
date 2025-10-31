# server/worker.py
import os, json, subprocess, tempfile, shlex, redis, uuid

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RESULT_TTL_SEC = 600
r = redis.from_url(REDIS_URL, decode_responses=True)

LANGS = {
  "python": {"image":"dvorak-py:latest", "compile": None, "run":"python3 Main.py"},
  "cpp":    {"image":"dvorak-cpp:latest","compile":"g++ -std=c++17 -O2 -s -o main Main.cpp","run":"./main"},
}

def sh(cmd, timeout=10, check=False, **kw):
  return subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=timeout, **kw)

def create_container(image: str) -> str:
  cmd = (
    f"docker create --network none --cpus 1 --memory 512m --pids-limit 256 "
    f"--tmpfs /tmp:rw,noexec --tmpfs /run:rw,noexec "
    f"{image} /bin/sh -lc 'sleep infinity'"
  )
  p = sh(cmd, timeout=10)
  if p.returncode != 0:
    raise RuntimeError(f"docker create failed: {p.stderr or p.stdout}")
  return p.stdout.strip()


def start_container(cid: str):
  p = sh(f"docker start {cid}", timeout=10)
  if p.returncode != 0:
    raise RuntimeError(f"docker start failed: {p.stderr or p.stdout}")

def cp_into(cid: str, src_dir: str, dest: str="/work"):
  # src_dir 내부의 모든 파일을 컨테이너의 dest 디렉토리로 복사
  # 파일들을 복사 - Windows와 Linux 모두 지원
  for fname in os.listdir(src_dir):
    src_file = os.path.join(src_dir, fname)
    if os.path.isfile(src_file):
      p = sh(f'docker cp "{src_file}" {cid}:{dest}/{fname}', timeout=30)
      if p.returncode != 0:
        raise RuntimeError(f"docker cp failed for {fname}: {p.stderr or p.stdout}")
  
  # 복사된 파일들의 소유권을 runner로 변경 (root로 실행)
  p = sh(f'docker exec -u root {cid} chown -R runner:runner {dest}', timeout=10)
  if p.returncode != 0:
    raise RuntimeError(f"chown failed: {p.stderr or p.stdout}")

def exec_in(cid: str, cmd: str, workdir: str="/work", timelimit_sec: int=5):
  # timeout으로 프로세스 제한
  # (Debian slim에는 coreutils timeout 있음. Alpine 쓰면 busybox 설치 필요)
  full = f'docker exec -w {shlex.quote(workdir)} {cid} /bin/sh -lc ' \
         f'{shlex.quote(f"timeout {timelimit_sec}s {cmd}")}'
  return sh(full, timeout=timelimit_sec+2)

def cleanup(cid: str):
  sh(f"docker rm -f {cid}", timeout=10)

def load_problem(problem_id):
  path = os.path.join("problems", f"{problem_id}.json")
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)

def judge(payload):
  prob = load_problem(payload["problem_id"])
  lang = payload["language"]
  code = payload["code"]
  if lang not in LANGS:
    return {"result":"RE","msg":f"unsupported language {lang}"}
  L = LANGS[lang]

  with tempfile.TemporaryDirectory() as td:
    main_file = "Main.py" if lang == "python" else "Main.cpp"
    with open(os.path.join(td, main_file), "w", encoding="utf-8", newline="\n") as f:
      f.write(code)

    cid = None
    try:
      cid = create_container(L["image"])
      start_container(cid)
      cp_into(cid, td, "/work")

      # compile
      if L["compile"]:
        cpr = exec_in(cid, L["compile"], "/work", timelimit_sec=20)
        if cpr.returncode != 0:
          return {"result":"CE","msg": (cpr.stderr or cpr.stdout)[-1500:]}

      # run testcases
      for i, tc in enumerate(prob["testcases"], 1):
        inp = tc.get("input","")
        expected = tc.get("output","")
        # printf로 입력 파이프
        run_cmd = f'printf %s {shlex.quote(inp)} | {L["run"]}'
        rr = exec_in(cid, run_cmd, "/work", timelimit_sec=max(1, prob.get("time_limit_ms",2000)//1000))
        if rr.returncode != 0:
          return {"result":"RE","case":i,"msg": (rr.stderr or rr.stdout)[-1000:]}
        out = rr.stdout
        checker = prob.get("checker","strict")
        if (checker=="strict" and out!=expected) or (checker!="strict" and out.strip()!=expected.strip()):
          return {"result":"WA","case":i,"got":out[:200],"exp":expected[:200]}
      return {"result":"AC"}
    finally:
      if cid:
        cleanup(cid)

def main():
  print("worker up", flush=True)
  while True:
    job = r.brpop("judge:queue", timeout=0)
    data = json.loads(job[1])
    if data.get("type") == "judge":
      job_id = data.get("job_id", str(uuid.uuid4()))
      res = judge(data["payload"])
      r.setex(f"result:{job_id}", RESULT_TTL_SEC, json.dumps(res))
      print({"job_id": job_id, **res}, flush=True)

if __name__ == "__main__":
  main()
