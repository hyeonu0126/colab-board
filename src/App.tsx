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

  // [신규 변경] 현재 선택된 펜 색상 상태 관리 (기본값: 검은색)
  const [selectedColor, setSelectedColor] = useState<string>('black');

  const [firebaseData, setFirebaseData] = useState<any>(null);
  const linesRef = ref(db, 'lines'); 

  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  const [tempErasedLines, setTempErasedLines] = useState<any[]>([]);

  // 화면 그리기 함수 (파이어베이스의 color 정보를 읽어서 선마다 다르게 스타일링합니다)
  const renderCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, data: any) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    
    Object.values(data).forEach((line: any) => {
      ctx.beginPath();
      ctx.moveTo(line.startX, line.startY);
      ctx.lineTo(line.endX, line.endY);
      
      // 🌟 파이어베이스에 저장된 색상이 있으면 그 색으로, 없으면 기본 검은색으로 그립니다.
      ctx.strokeStyle = line.color || 'black';
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

  const handleMouseMove = (e: React.MouseEvent) => {
    const currentPos = getMousePos(e);

    if ((currentMode === 'erase_partial' || currentMode === 'erase_stroke') && isErasing) {
      handleEraserAction(currentPos);
    } else if (currentMode === 'draw' && isDrawing && currentStrokeId) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 🌟 [최적화 유지] 내가 고른 색상(`selectedColor`)으로 내 화면에 0ms 즉시 드로잉 처리
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.strokeStyle = selectedColor;
      ctx.stroke();

      // 🌟 파이어베이스 데이터베이스에도 현재 선의 색상값(`color`)을 같이 묶어서 쏩니다.
      const newLineRef = push(linesRef);
      set(newLineRef, {
        startX: lastPos.x,
        startY: lastPos.y,
        endX: currentPos.x,
        endY: currentPos.y,
        strokeId: currentStrokeId,
        color: selectedColor // 색상 데이터 추가
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
      // 복원 시에도 기존에 저장되어 있던 고유의 색상(`color`) 속성을 누락 없이 그대로 원상복구합니다.
      lastAction.restoredLines.forEach((lineData) => {
        const newLineRef = push(linesRef);
        set(newLineRef, {
          startX: lineData.startX,
          startY: lineData.startY,
          endX: lineData.endX,
          endY: lineData.endY,
          strokeId: lineData.strokeId,
          color: lineData.color || 'black'
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

  // 제공할 컬러 프리셋 배열
  const colors = ['black', '#ff3b30', '#007aff', '#4cd964', '#ffcc00', '#5856d6'];

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      {/* 🛠️ 한층 업그레이드된 통합 컨트롤러 툴바 */}
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        
        {/* 상단 레이어: 액션 툴 버튼 세트 */}
        <div style={{ display: 'flex', gap: '10px' }}>
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

        {/* 하단 레이어: [신규] 실시간 펜 색상 선택기 패널 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(255,255,255,0.9)', padding: '8px 12px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: 'fit-content' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#555' }}>🎨 펜 색상 :</span>
          {colors.map((color) => (
            <button
              key={color}
              onClick={() => {
                setSelectedColor(color);
                setCurrentMode('draw'); // 색상을 고르면 편의성을 위해 자동으로 그리기 모드로 전환되게 유도합니다.
              }}
              style={{
                width: '28px',
                height: '28px',
                backgroundColor: color,
                border: selectedColor === color ? '3px solid #333' : '1px solid rgba(0,0,0,0.2)',
                borderRadius: '50%',
                cursor: 'pointer',
                transform: selectedColor === color ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.1s ease',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
              }}
            />
          ))}
        </div>

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