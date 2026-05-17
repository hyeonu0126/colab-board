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

  const [selectedColor, setSelectedColor] = useState<string>('black');
  const [lineWidth, setLineWidth] = useState<number>(5);

  const [firebaseData, setFirebaseData] = useState<any>(null);
  const linesRef = ref(db, 'lines'); 

  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  const [tempErasedLines, setTempErasedLines] = useState<any[]>([]);

  // 화면 그리기 함수
  const renderCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, data: any) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    
    Object.values(data).forEach((line: any) => {
      ctx.beginPath();
      ctx.moveTo(line.startX, line.startY);
      ctx.lineTo(line.endX, line.endY);
      
      ctx.strokeStyle = line.color || 'black';
      ctx.lineWidth = line.lineWidth || 1; 
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
    if (l2 === 0) return Math.sqrt((px - sx) ** 2 + (py - py) ** 2);
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

  // 🌟 [수정 완료] 마우스를 누르는 순간 점(아주 짧은 선)을 즉시 생성하여 표현
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

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. 로컬 렌더링: 누른 자리에 지름이 lineWidth인 점을 즉시 그립니다.
      ctx.beginPath();
      ctx.moveTo(clickPos.x, clickPos.y);
      ctx.lineTo(clickPos.x + 0.1, clickPos.y + 0.1); // 아주 미세하게 선을 늘려 lineCap='round'에 의해 완벽한 원 형태의 점이 되도록 유도
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = lineWidth; 
      ctx.stroke();

      // 2. 파이어베이스 전송: 드래그하지 않고 떼더라도 점이 남도록 즉시 백그라운드로 보냅니다.
      const newLineRef = push(linesRef);
      set(newLineRef, {
        startX: clickPos.x,
        startY: clickPos.y,
        endX: clickPos.x + 0.1,
        endY: clickPos.y + 0.1,
        strokeId: newId,
        color: selectedColor,
        lineWidth: lineWidth 
      });

      // 마우스가 이동할 때 자연스럽게 이어지도록 좌표 보정 업데이트
      setLastPos({ x: clickPos.x + 0.1, y: clickPos.y + 0.1 });
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

      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = lineWidth; 
      ctx.stroke();

      const newLineRef = push(linesRef);
      set(newLineRef, {
        startX: lastPos.x,
        startY: lastPos.y,
        endX: currentPos.x,
        endY: currentPos.y,
        strokeId: currentStrokeId,
        color: selectedColor,
        lineWidth: lineWidth 
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
          strokeId: lineData.strokeId,
          color: lineData.color || 'black',
          lineWidth: lineData.lineWidth || 1
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

  const colors = ['black', '#ff3b30', '#007aff', '#4cd964', '#ffcc00', '#5856d6'];

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', backgroundColor: 'rgba(255,255,255,0.9)', padding: '10px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: 'fit-content' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#555' }}>색상:</span>
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => {
                  setSelectedColor(color);
                  setCurrentMode('draw');
                }}
                style={{
                  width: '24px', height: '24px', backgroundColor: color,
                  border: selectedColor === color ? '3px solid #333' : '1px solid rgba(0,0,0,0.2)',
                  borderRadius: '50%', cursor: 'pointer',
                  transform: selectedColor === color ? 'scale(1.1)' : 'scale(1)',
                  transition: 'transform 0.1s ease'
                }}
              />
            ))}
          </div>

          <div style={{ width: '1px', height: '20px', backgroundColor: '#ccc' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#555' }}>굵기 조절:</span>
            <input 
              type="range" 
              min="1" 
              max="20" 
              step="1" 
              value={lineWidth} 
              onChange={(e) => {
                setLineWidth(parseInt(e.target.value));
                setCurrentMode('draw');
              }}
              style={{ cursor: 'pointer', width: '120px' }}
            />
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#007aff', minWidth: '45px' }}>
              {lineWidth} mm
            </span>
          </div>

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