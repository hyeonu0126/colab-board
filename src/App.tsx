import { useEffect, useRef, useState } from 'react'
import { db } from './firebase'
import { ref, onValue, push, set, remove } from "firebase/database";

// 마우스 툴 상태 정의
type ToolMode = 'draw' | 'erase_partial' | 'erase_stroke';

// 히스토리에 기록할 작업의 타입
type HistoryAction = {
  type: 'draw' | 'erase';
  strokeId?: string; // 그리기 되돌리기용
  restoredLines?: any[]; // 지우기(부분/획/전체 화면 포함) 되돌리기용 백업 데이터
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

  // 사용자가 수행한 작업들을 저장하는 로컬 스택 (Undo용)
  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  // 지우개 질 한 번 동안 지워진 선들을 임시로 모으는 배열
  const [tempErasedLines, setTempErasedLines] = useState<any[]>([]);

  // 화면 그리기 함수
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

  // 점과 직선 사이의 거리 계산 함수
  const getDistanceToLine = (px: number, py: number, sx: number, sy: number, ex: number, ey: number) => {
    const l2 = (ex - sx) ** 2 + (ey - sy) ** 2;
    if (l2 === 0) return Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
    let t = ((px - sx) * (ex - sx) + (py - sy) * (ey - sy)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((px - (sx + t * (ex - sx))) ** 2 + (py - (sy + t * (ey - sy))) ** 2);
  };

  // 지우개 모드 처리 함수
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

  const handleMouseMove = (e: React.MouseEvent) => {
    const currentPos = getMousePos(e);

    if ((currentMode === 'erase_partial' || currentMode === 'erase_stroke') && isErasing) {
      handleEraserAction(currentPos);
    } else if (currentMode === 'draw' && isDrawing && currentStrokeId) {
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

  // 그리기든, 부분 지우개든, 전체 화면 지우기든 상관없이 되돌리는 통합 Undo 메커니즘
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
      // 부분/획/전체 화면 지우기로 인해 지워졌던 선들을 순치적으로 재복원 push
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

  // [수정 사항] 전체 화면을 밀기 전에 현재 캔버스의 모든 선 데이터를 복원 스택에 백업합니다.
  const clearCanvas = () => {
    if (!firebaseData) return;

    // 1. 현재 데이터베이스에 띄워져 있는 모든 선 조각을 배열로 추출
    const allLines = Object.values(firebaseData);

    if (allLines.length > 0) {
      // 2. 전체 화면 지우기도 하나의 '거대한 지우기 액션'으로 히스토리에 박아둠
      setHistoryStack((prev) => [...prev, { type: 'erase', restoredLines: allLines }]);
    }

    // 3. 백업 완료 후 파이어베이스 폭파
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