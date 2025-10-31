"use client";

import useSWR from "swr";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import Editor, { type OnChange } from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const fetcher = (url: string) => fetch(url).then(r => r.json());

type Problem = { id: string; title: string; languages: string[] };
type ProblemDetail = { 
  id: string; 
  title: string; 
  description: string; 
  time_limit_ms: number; 
  memory_limit_mb: number; 
};
type SubmitResp = { ok: boolean; job_id: string };
type ResultResp = { done: boolean; result?: { result: string; case?: number; msg?: string; got?: string; exp?: string } };
type Language = "python" | "cpp";

export default function Page() {
  const { data: problems } = useSWR<Problem[]>(`${API}/problems`, fetcher);
  const [problemId, setProblemId] = useState<string>("");
  const { data: problemDetail } = useSWR<ProblemDetail>(
    problemId ? `${API}/problems/${problemId}` : null,
    fetcher
  );
  const [lang, setLang] = useState<Language>("python");
  const [code, setCode] = useState<string>('print("Hello, Dvorak!")\n');
  const [log, setLog] = useState<string>("준비 완료.");
  const [jobId, setJobId] = useState<string>("");
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  
  // 타이머 관련 상태
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [timerStarted, setTimerStarted] = useState<boolean>(false); // 타이머가 한 번이라도 시작되었는지
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const initialCodeRef = useRef<string>('print("Hello, Dvorak!")\n');

  useEffect(() => {
    if (problems?.length && !problemId && problems[0]) {
      setProblemId(problems[0].id);
    }
  }, [problems, problemId]);

  useEffect(() => {
    if (lang === "cpp") {
      const newCode = `#include <bits/stdc++.h>
using namespace std;
int main(){ cout << "Hello, Dvorak!\\n"; }`;
      setCode(newCode);
      initialCodeRef.current = newCode;
    } else {
      const newCode = 'print("Hello, Dvorak!")\n';
      setCode(newCode);
      initialCodeRef.current = newCode;
    }
    
    // 언어 변경 시 타이머 리셋
    setIsTimerRunning(false);
    setStartTime(null);
    setElapsedTime(0);
    setTimerStarted(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [lang]);

  // 문제 변경 시 타이머 리셋
  useEffect(() => {
    setIsTimerRunning(false);
    setStartTime(null);
    setElapsedTime(0);
    setTimerStarted(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [problemId]);

  // 타이머 업데이트
  useEffect(() => {
    if (isTimerRunning && startTime) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isTimerRunning, startTime]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const onSubmit = async () => {
    if (!problemId) { setLog("문제를 선택해."); return; }
    setLog("제출 중...");
    try {
      const r = await axios.post<SubmitResp>(`${API}/submit`, { problem_id: problemId, language: lang, code });
      setJobId(r.data.job_id);
      setLog(`제출됨. job_id=${r.data.job_id} — 채점 중...`);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const rr = await axios.get<ResultResp>(`${API}/result/${r.data.job_id}`);
        if (rr.data.done) {
          const res = rr.data.result!;
          const head = `결과: ${res.result}`;
          let detail = "";
          if (res.case) detail += `\n케이스: ${res.case}`;
          if (res.msg)  detail += `\n메시지: ${res.msg}`;
          if (res.got)  detail += `\nGOT:\n${res.got}`;
          if (res.exp)  detail += `\nEXP:\n${res.exp}`;
          
          // AC일 때 타이머 정지
          if (res.result === "AC") {
            setIsTimerRunning(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
          
          setLog(head + detail);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }, 800);
    } catch (e: any) {
      setLog("제출 실패: " + (e?.message ?? e));
    }
  };

  const handleLangChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "python" || value === "cpp") {
      setLang(value);
    }
  };

  const handleEditorChange: OnChange = (value) => {
    const newCode = value ?? "";
    setCode(newCode);
    
    // 처음 코드를 수정하기 시작하면 타이머 시작
    if (!isTimerRunning && !timerStarted && newCode !== initialCodeRef.current) {
      setIsTimerRunning(true);
      setTimerStarted(true);
      setStartTime(Date.now());
    }
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
  };

  const getResultColor = () => {
    if (log.includes("AC") || log.includes("준비")) return "#10b981";
    if (log.includes("WA")) return "#f59e0b";
    if (log.includes("RE") || log.includes("CE")) return "#ef4444";
    if (log.includes("제출") || log.includes("채점")) return "#3b82f6";
    return "#6366f1";
  };

  return (
      <div style={{ 
        height: "100vh",
        background: "linear-gradient(to bottom right, #f0f9ff, #e0e7ff, #fce7f3)",
        padding: "16px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        <div style={{ 
          maxWidth: 1400, 
          margin: "0 auto",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden"
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 16
          }}>
            <h1 style={{ 
              margin: 0, 
              fontSize: "clamp(24px, 4vw, 40px)",
              fontWeight: 700,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8
            }}>
              <span style={{ fontSize: "clamp(28px, 5vw, 48px)" }}>⌨️</span>
              <span style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}>
                Dvorak Coding Challenge
              </span>
            </h1>
            
            {timerStarted && (
              <div style={{
                background: isTimerRunning 
                  ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                  : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                padding: "8px 20px",
                borderRadius: 8,
                color: "white",
                fontWeight: 700,
                fontSize: "clamp(18px, 2.5vw, 24px)",
                fontFamily: "monospace",
                boxShadow: isTimerRunning 
                  ? "0 4px 12px rgba(16, 185, 129, 0.3)"
                  : "0 4px 12px rgba(59, 130, 246, 0.3)",
                animation: isTimerRunning ? "pulse 2s ease-in-out infinite" : "none",
                minWidth: "140px",
                textAlign: "center",
                transition: "all 0.3s ease"
              }}>
                <style dangerouslySetInnerHTML={{__html: `
                  @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.8; }
                  }
                `}} />
                {isTimerRunning ? "⏱️" : "✅"} {formatTime(elapsedTime)}
              </div>
            )}
          </div>

          {problemDetail && (
            <div style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              padding: 16,
              borderRadius: 12,
              color: "white",
              boxShadow: "0 8px 16px rgba(102, 126, 234, 0.3)",
              transition: "all 0.3s ease",
              animation: "slideIn 0.5s ease-out",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column"
            }}>
              <style jsx>{`
                @keyframes slideIn {
                  from {
                    opacity: 0;
                    transform: translateY(-20px);
                  }
                  to {
                    opacity: 1;
                    transform: translateY(0);
                  }
                }
              `}</style>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
                gap: 12,
                flexWrap: "wrap"
              }}>
                <h2 style={{ 
                  margin: 0, 
                  fontSize: "clamp(18px, 2.5vw, 22px)", 
                  fontWeight: 700,
                  textShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}>
                  📝 {problemDetail.title}
                </h2>
                
                <div style={{ 
                  display: "flex", 
                  gap: 8, 
                  alignItems: "center",
                  flexWrap: "wrap"
                }}>
                  <label style={{ fontWeight: 600, fontSize: 13 }}>문제:</label>
                  <select 
                    value={problemId} 
                    onChange={e => setProblemId(e.target.value)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "2px solid rgba(255,255,255,0.3)",
                      fontSize: 13,
                      transition: "all 0.2s ease",
                      cursor: "pointer",
                      outline: "none",
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      fontWeight: 500
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.3)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
                  >
                    {problems?.map(p => <option key={p.id} value={p.id} style={{color: "#000"}}>{p.id} - {p.title}</option>)}
                  </select>
                  
                  <label style={{ fontWeight: 600, fontSize: 13, marginLeft: 4 }}>언어:</label>
                  <select 
                    value={lang} 
                    onChange={handleLangChange}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "2px solid rgba(255,255,255,0.3)",
                      fontSize: 13,
                      transition: "all 0.2s ease",
                      cursor: "pointer",
                      outline: "none",
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      fontWeight: 500
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.3)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
                  >
                    <option value="python" style={{color: "#000"}}>🐍 Python</option>
                    <option value="cpp" style={{color: "#000"}}>⚡ C++</option>
                  </select>
                  
                  <button 
                    onClick={onSubmit}
                    style={{
                      padding: "7px 18px",
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      border: "2px solid rgba(255,255,255,0.4)",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.3s ease",
                      backdropFilter: "blur(10px)"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.3)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.2)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    🚀 제출
                  </button>
                </div>
              </div>
              <div 
                className="problem-description"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  padding: 12,
                  borderRadius: 8,
                  lineHeight: 1.6,
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  transition: "all 0.3s ease",
                  fontSize: "clamp(12px, 1.5vw, 14px)",
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto"
                }}>
                <style dangerouslySetInnerHTML={{__html: `
                  .problem-description h2 {
                    font-size: clamp(16px, 2vw, 18px) !important;
                    font-weight: 700;
                    margin: 12px 0 8px 0;
                    border-bottom: 2px solid rgba(255,255,255,0.3);
                    padding-bottom: 4px;
                  }
                  .problem-description h2:first-child {
                    margin-top: 0;
                  }
                  .problem-description p {
                    margin: 8px 0;
                  }
                  .problem-description strong {
                    font-weight: 700;
                  }
                  .problem-description code {
                    background: rgba(0,0,0,0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: monospace;
                  }
                `}} />
                <ReactMarkdown>
                  {problemDetail.description}
                </ReactMarkdown>
              </div>
              <div style={{ 
                marginTop: 8, 
                fontSize: "clamp(11px, 1.2vw, 13px)", 
                opacity: 0.95,
                display: "flex",
                gap: 12,
                fontWeight: 500
              }}>
                <span>⏱️ 시간: {problemDetail.time_limit_ms}ms</span>
                <span>💾 메모리: {problemDetail.memory_limit_mb}MB</span>
              </div>
            </div>
          )}

          <div style={{ 
            background: "white",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            border: "2px solid #e5e7eb",
            transition: "all 0.3s ease",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column"
          }}>
            <div style={{
              background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
              padding: "10px 16px",
              color: "white",
              fontWeight: 600,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0
            }}>
              💻 코드 에디터
              <span style={{ 
                marginLeft: "auto", 
                fontSize: 12, 
                opacity: 0.9,
                background: "rgba(255,255,255,0.2)",
                padding: "4px 10px",
                borderRadius: 6
              }}>
                {lang === "python" ? "🐍 Python" : "⚡ C++"}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="100%"
                defaultLanguage={lang === "cpp" ? "cpp" : "python"}
                language={lang === "cpp" ? "cpp" : "python"}
                value={code}
                onChange={handleEditorChange}
                options={{ 
                  minimap: { enabled: false }, 
                  fontSize: 14, 
                  tabSize: 2,
                  padding: { top: 8 }
                }}
              />
            </div>
          </div>

          <div style={{
            background: "white",
            padding: 16,
            borderRadius: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            border: "2px solid #e5e7eb",
            flexShrink: 0,
            minHeight: "140px",
            maxHeight: "200px",
            display: "flex",
            flexDirection: "column"
          }}>
            <h3 style={{ 
              margin: "0 0 12px 0",
              fontSize: "clamp(16px, 2vw, 18px)",
              fontWeight: 700,
              color: "#1f2937",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0
            }}>
              📊 채점 결과
            </h3>
            <pre style={{
              background: "#1a1a2e",
              color: getResultColor(),
              padding: 16,
              borderRadius: 8,
              flex: 1,
              minHeight: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "Consolas, Monaco, 'Courier New', monospace",
              fontSize: "clamp(12px, 1.5vw, 14px)",
              lineHeight: 1.5,
              border: `3px solid ${getResultColor()}`,
              boxShadow: `0 0 20px ${getResultColor()}33`,
              transition: "all 0.5s ease",
              margin: 0,
              overflowY: "auto"
            }}>{log}</pre>
          </div>
        </div>
      </div>
  );
}
