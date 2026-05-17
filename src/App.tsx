import { useEffect, useRef, useState } from 'react'
import { db } from './firebase'
import { ref, onValue, push, set, remove } from "firebase/database";

type ToolMode = 'draw' | 'erase_partial' | 'erase_stroke';

type HistoryAction = {
  type: 'draw' | 'erase';
  strokeId?: string;
  restoredLines?: any[];
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  
  const [currentMode, setCurrentMode] = useState<ToolMode>('draw'); 
  const [isErasing, setIsErasing] = useState(false); 
  const [currentStrokeId, setCurrentStrokeId] = useState<string | null>(null);

  const [firebaseData, setFirebaseData] = useState<any>(null);
  const linesRef = ref(db, 'lines'); 

  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  const [tempErasedLines, setTempErasedLines] = useState<any[]>([]);

  // 화면 전체를 싹 다시 그리는 함수 (파이어베이스 데이터 기반)
  const renderCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, data: any) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    
    Object.values(data).forEach((line: any) => {
      ctx.beginPath();
      ctx.moveTo(line.startX, line.startY);
      ctx.lineTo(line.endX, line.endY);
      ctx.stroke();
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'black';
      
      if (firebaseData) renderCanvas(canvas, ctx, firebaseData);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const unsubscribe = onValue(linesRef, (snapshot) => {
      const data = snapshot.val();
      setFirebaseData(data);
    });

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      unsubscribe();
    };
  }, [firebaseData]);

  const getMousePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getDistanceToLine = (px: number, py: number, sx: number, sy: number, ex: number, ey: number) => {
    const l2 = (ex - sx) ** 2 + (ey - sy) ** 2;
    if (l2 === 0) return Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
    let t = ((px - sx) * (ex - sx) + (py - sy) * (ey - sy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((px - (sx + t * (ex - sx))) ** 2 + (py - (sy + t * (ey - sy))) ** 2);
  };

  const handleEraserAction = (currentPos: { x: number, y: number }) => {
    if (!firebaseData) return;

    const eraseRadius = 20; 
    const targetKeys: string[] = [];
    const targetStrokeIds: string[] = [];

    Object.entries(firebaseData).forEach(([key, line]: [string, any]) => {
      const distance = getDistanceToLine(currentPos.x, currentPos.y, line.startX, line.startY, line.endX, line.endY);
      
      if (distance < eraseRadius) {
        targetKeys.push(key); 
        if (line.strokeId) {
          targetStrokeIds.push(line.strokeId); 
        }
      }
    });

    const linesToBackup: any[] = [];

    if (currentMode === 'erase_partial') {
      targetKeys.forEach((key) => {
        if (firebaseData[key]) {
          linesToBackup.push(firebaseData[key]);
          remove(ref(db, `lines/${key}`));
        }
      });
    } else if (currentMode === 'erase_stroke') {
      if (targetStrokeIds.length > 0) {
        Object.entries(firebaseData).forEach(([key, line]: [string, any]) => {
          if (targetStrokeIds.includes(line.strokeId)) {
            linesToBackup.push(line);
            remove(ref(db, `lines/${key}`));
          }
        });
      }
    }

    if (linesToBackup.length > 0) {
      setTempErasedLines((prev) => [...prev, ...linesToBackup]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const clickPos = getMousePos(e);
    
    if (currentMode === 'erase_partial' || currentMode === 'erase_stroke') {
      setIsErasing(true);
      setTempErasedLines([]); 
      handleEraserAction(clickPos);
    } else if (currentMode === 'draw') {
      setIsDrawing(true);
      setLastPos(clickPos);
      const newId = Math.random().toString(36).substr(2, 9);
      setCurrentStrokeId(newId);
    }
  };

  // [핵심 최적화 반영 파트] 마우스 무브 실시간 렌더링 분리
  const handleMouseMove = (e: React.MouseEvent) => {
    const currentPos = getMousePos(e);

    if ((currentMode === 'erase_partial' || currentMode === 'erase_stroke') && isErasing) {
      handleEraserAction(currentPos);
    } else if (currentMode === 'draw' && isDrawing && currentStrokeId) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 🌟 1. 파이어베이스 응답을 기다리지 않고, 내 화면에 0ms 즉시 선을 긋습니다 (로컬 선 렌더링)
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.stroke();

      // 🌟 2. 내 화면엔 이미 그렸으니, 파이어베이스에는 백그라운드로 비동기 전송만 던져둡니다.
      const newLineRef = push(linesRef);
      set(newLineRef, {
        startX: lastPos.x,
        startY: lastPos.y,
        endX: currentPos.x,
        endY: currentPos.y,
        strokeId: currentStrokeId 
      });

      setLastPos(currentPos);
    }
  };

  const handleMouseUp = () => {
    if (currentMode === 'draw' && isDrawing && currentStrokeId) {
      setHistoryStack((prev) => [...prev, { type: 'draw', strokeId: currentStrokeId }]);
    } else if ((currentMode === 'erase_partial' || currentMode === 'erase_stroke') && isErasing) {
      if (tempErasedLines.length > 0) {
        setHistoryStack((prev) => [...prev, { type: 'erase', restoredLines: tempErasedLines }]);
      }
    }

    setIsDrawing(false);
    setIsErasing(false);
    setCurrentStrokeId(null); 
  };

  const handleUndo = async () => {
    if (historyStack.length === 0) return; 

    const lastAction = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1)); 

    if (lastAction.type === 'draw' && lastAction.strokeId) {
      if (!firebaseData) return;
      Object.entries(firebaseData).forEach(([key, line]: [string, any]) => {
        if (line.strokeId === lastAction.strokeId) {
          remove(ref(db, `lines/${key}`));
        }
      });
    } else if (lastAction.type === 'erase' && lastAction.restoredLines) {
      lastAction.restoredLines.forEach((lineData) => {
        const newLineRef = push(linesRef);
        set(newLineRef, {
          startX: lineData.startX,
          startY: lineData.startY,
          endX: lineData.endX,
          endY: lineData.endY,
          strokeId: lineData.strokeId
        });
      });
    }
  };

  const clearCanvas = () => {
    if (!firebaseData) return;
    const allLines = Object.values(firebaseData);
    if (allLines.length > 0) {
      setHistoryStack((prev) => [...prev, { type: 'erase', restoredLines: allLines }]);
    }
    remove(linesRef);
  };

  const getCanvasCursor = () => {
    if (currentMode === 'erase_partial') return 'not-allowed';
    if (currentMode === 'erase_stroke') return 'cell';
    return 'default';
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button 
          onClick={() => setCurrentMode('draw')}
          style={{
            padding: '10px 20px', 
            backgroundColor: currentMode === 'draw' ? '#007aff' : '#ffffff', 
            color: currentMode === 'draw' ? '#ffffff' : '#333333',
            border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          🎨 그리기 모드
        </button>

        <button 
          onClick={() => setCurrentMode('erase_partial')}
          style={{
            padding: '10px 20px', 
            backgroundColor: currentMode === 'erase_partial' ? '#ff9500' : '#ffffff', 
            color: currentMode === 'erase_partial' ? '#ffffff' : '#333333',
            border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          🧹 부분 지우개
        </button>

        <button 
          onClick={() => setCurrentMode('erase_stroke')}
          style={{
            padding: '10px 20px', 
            backgroundColor: currentMode === 'erase_stroke' ? '#5856d6' : '#ffffff', 
            color: currentMode === 'erase_stroke' ? '#ffffff' : '#333333',
            border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          ✒️ 획 전체 지우개
        </button>

        <button 
          onClick={handleUndo}
          style={{
            padding: '10px 20px', backgroundColor: '#ffffff', color: '#007aff',
            border: '2px dashed #007aff', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          ↩️ 작업 되돌리기 (Undo)
        </button>

        <button 
          onClick={clearCanvas}
          style={{
            padding: '10px 20px', backgroundColor: '#ff4d4f', color: 'white',
            border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          💥 전체 화면 지우기
        </button>
      </div>
      
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseUp}
        style={{ display: 'block', backgroundColor: '#f0f0f0', cursor: getCanvasCursor() }}
      />
    </div>
  )
}

export default App