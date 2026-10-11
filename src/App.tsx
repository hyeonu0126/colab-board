import React, { useEffect, useRef, useState } from 'react'
import { db } from './firebase'
import { ref, onValue, push, set, remove, get } from "firebase/database";
import { MeetingRoomLanding } from './MeetingRoomLanding';
import { Peer } from 'peerjs'; 

interface ImageData {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type ToolMode = 'draw' | 'erase_partial' | 'erase_stroke';

type HistoryAction = {
  type: 'draw' | 'erase';
  strokeId?: string;
  restoredLines?: any[];
};

function App() {
  //const [images, setImages] = useState<Record<string, ImageData>>({});
  const [roomName, setRoomName] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  // 🚪 방 입장 전 닉네임 중복 검사를 위한 헬퍼 핸들러
  const handleJoinAttempt = async (joinedRoomName: string, authenticatedUserName: string) => {
    const usersRef = ref(db, `rooms/${joinedRoomName}/users`);
    try {
      const snapshot = await get(usersRef);
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        // 대소문자 및 공백을 제거하고 동일한 닉네임이 있는지 검사
        const isExist = Object.keys(usersData).some(
          (name) => name.trim().toLowerCase() === authenticatedUserName.trim().toLowerCase()
        );

        if (isExist) {
          alert('이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.');
          return false; // 입장 실패
        }
      }
      
      // 중복이 없으면 정상 입장 처리
      setRoomName(joinedRoomName);
      setUserName(authenticatedUserName);
      return true;
    } catch (error) {
      console.error("닉네임 중복 체크 중 오류 발생:", error);
      alert("방 입장 처리 중 오류가 발생했습니다.");
      return false;
    }
  };

  const handleLeaveRoom = () => {
    setRoomName(null);
    setUserName(null);
  };

  if (roomName && userName) {
    return <WhiteboardCanvas roomName={roomName} userName={userName} onLeave={handleLeaveRoom} />;
  }

  return <MeetingRoomLanding onJoinSuccess={(room, user) => handleJoinAttempt(room, user)} />;
}

interface CanvasProps {
  roomName: string;
  userName: string;
  onLeave: () => void;
}

interface RemoteUserAudio {
  userName: string;
  peerId: string;
  streamId: string;
  audioElement: HTMLAudioElement;
}

const WhiteboardCanvas: React.FC<CanvasProps> = ({ roomName, userName, onLeave }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  
  const [currentMode, setCurrentMode] = useState<ToolMode>('draw'); 
  const [isErasing, setIsErasing] = useState(false); 
  const [currentStrokeId, setCurrentStrokeId] = useState<string | null>(null);

  const [selectedColor, setSelectedColor] = useState<string>('#f5f5f5');
  const [lineWidth, setLineWidth] = useState<number>(5);

  const [firebaseData, setFirebaseData] = useState<any>(null);
  const linesRef = ref(db, `rooms/${roomName}/lines`); 

  const [historyStack, setHistoryStack] = useState<HistoryAction[]>([]);
  const [tempErasedLines, setTempErasedLines] = useState<any[]>([]);

  const [roomUsers, setRoomUsers] = useState<any[]>([]);

  const [images, setImages] = useState<Record<string, any>>({});
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // 🎙️ 보이스톡 상태 관리 (최초 입장 시 음소거 true)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(true); 
  const peerRef = useRef<Peer | null>(null);
  const currentCalls = useRef<any[]>([]); 
  const localStreamRef = useRef<MediaStream | null>(null);

  // 🎛️ 참가자별 볼륨 관리 상태
  const [volumes, setVolumes] = useState<{ [key: string]: number }>({});
  const [remoteAudios, setRemoteAudios] = useState<RemoteUserAudio[]>([]);

  // 🎙️ 보이스톡 핵심 라이프사이클
  useEffect(() => {
    let myPeer: Peer;
    let stream: MediaStream;
    let unsubscribeUsers: (() => void) | null = null;

    const initVoiceChat = async () => {
      try {
        // 2중 방어 코드: 진입 시점에 한 번 더 중복 선점 여부 체크
        const userCheckRef = ref(db, `rooms/${roomName}/users/${userName}`);
        const userCheckSnapshot = await get(userCheckRef);
        if (userCheckSnapshot.exists()) {
          alert('이미 사용 중인 닉네임입니다. 다른 닉네임으로 다시 입장해주세요.');
          onLeave();
          return;
        }

        // 1. 내 마이크 스트림 가져오기
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true, 
            noiseSuppression: true   
          }, 
          video: false 
        });

        // 처음 입장할 때는 오디오 트랙을 비활성화(음소거) 처리
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = false; 
        }

        setLocalStream(stream);
        localStreamRef.current = stream; 

        // 2. PeerJS 객체 생성
        myPeer = new Peer();
        peerRef.current = myPeer;

        myPeer.on('open', (peerId) => {
          console.log('내 Peer ID 발급 완료:', peerId);
          const myUserRef = ref(db, `rooms/${roomName}/users/${userName}`);
          set(myUserRef, { userName, peerId });
        });

        // 3. 상대방으로부터 들어오는 전화 받기
        myPeer.on('call', (call) => {
          console.log('전화 수신:', call.peer);
          if (localStreamRef.current) {
            call.answer(localStreamRef.current);
            call.on('stream', (remoteStream) => {
              get(ref(db, `rooms/${roomName}/users`)).then((snap) => {
                const uList = snap.val() ? Object.values(snap.val()) : [];
                const matchingUser = uList.find((u: any) => u.peerId === call.peer) as any;
                const senderName = matchingUser ? matchingUser.userName : '알 수 없는 사용자';
                
                playRemoteStream(remoteStream, senderName, call.peer);
              });
            });
            currentCalls.current.push(call);
          }
        });

        // 4. 참여자 목록 실시간 감시 및 발신
        const allUsersRef = ref(db, `rooms/${roomName}/users`);
        unsubscribeUsers = onValue(allUsersRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const userList = Object.values(data);
            setRoomUsers(userList);

            userList.forEach((user: any) => {
              if (user.userName !== userName && user.peerId) {
                const alreadyConnected = currentCalls.current.some(c => c.peer === user.peerId);
                
                if (!alreadyConnected && myPeer && localStreamRef.current) {
                  console.log(`${user.userName}에게 통화 발신 시도`);
                  const call = myPeer.call(user.peerId, localStreamRef.current);
                  
                  if (call) {
                    call.on('stream', (remoteStream) => {
                      playRemoteStream(remoteStream, user.userName, user.peerId);
                    });
                    currentCalls.current.push(call);
                  }
                }
              }
            });
          } else {
            setRoomUsers([]);
          }
        });

      } catch (err) {
        console.error('마이크 획득 실패 혹은 PeerJS 오류:', err);
        alert('마이크를 찾을 수 없거나 권한이 거부되어 음소거 상태로 화이트보드만 활성화됩니다.');
        
        const myUserRef = ref(db, `rooms/${roomName}/users/${userName}`);
        set(myUserRef, { userName, peerId: null });
        
        const allUsersRef = ref(db, `rooms/${roomName}/users`);
        unsubscribeUsers = onValue(allUsersRef, (snapshot) => {
          const data = snapshot.val();
          if (data) setRoomUsers(Object.values(data));
        });
      }
    };

    initVoiceChat();

    return () => {
      const myUserRef = ref(db, `rooms/${roomName}/users/${userName}`);
      remove(myUserRef);

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      currentCalls.current.forEach(call => {
        try { call.close(); } catch(e) {}
      });
      if (myPeer) {
        myPeer.destroy();
      }
      if (unsubscribeUsers) {
        unsubscribeUsers();
      }
      setRemoteAudios((prev) => {
        prev.forEach(item => item.audioElement.remove());
        return [];
      });
    };
  }, [roomName, userName]);

  const playRemoteStream = (remoteStream: MediaStream, targetUserName: string, peerId: string) => {
    setRemoteAudios((prev) => {
      const isExist = prev.some(item => item.streamId === remoteStream.id);
      if (isExist) return prev;

      const audio = document.createElement('audio');
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);

      const savedVolume = volumes[targetUserName] !== undefined ? volumes[targetUserName] : 0.8;
      audio.volume = savedVolume;

      if (volumes[targetUserName] === undefined) {
        setVolumes(v => ({ ...v, [targetUserName]: 0.8 }));
      }

      return [...prev, {
        userName: targetUserName,
        peerId,
        streamId: remoteStream.id,
        audioElement: audio
      }];
    });
  };

  const handleVolumeChange = (targetName: string, value: number) => {
    setVolumes(prev => ({ ...prev, [targetName]: value }));
    
    remoteAudios.forEach((audioItem) => {
      if (audioItem.userName === targetName) {
        audioItem.audioElement.volume = value;
      }
    });
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled; 
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

const kickUser = async (targetUserName: string) => {
  const inputPassword = prompt(`${targetUserName} 님을 추방하려면 관리자 비밀번호를 입력하세요:`);
  if (!inputPassword) return;

  const roomRootRef = ref(db, `rooms/${roomName}`);
  try {
    const snapshot = await get(roomRootRef);
    if (snapshot.exists()) {
      if (snapshot.val().adminPass === inputPassword.trim()) {
        await remove(ref(db, `rooms/${roomName}/users/${targetUserName}`));
        alert(`${targetUserName} 님이 추방되었습니다.`);
      } else {
        alert('관리자 비밀번호가 일치하지 않습니다.');
      }
    }
  } catch (error) {
    console.error(error);
    alert('추방 처리 중 오류가 발생했습니다.');
  }
};

  const handleDeleteRoom = async () => {
    const inputPassword = prompt('회의방을 완전히 삭제하려면 "관리자 비밀번호"를 입력하세요:');
    if (!inputPassword) return;

    const roomRootRef = ref(db, `rooms/${roomName}`);
    
    try {
      const snapshot = await get(roomRootRef);
      if (snapshot.exists()) {
        const roomData = snapshot.val();
        
        if (roomData.adminPass === inputPassword.trim()) {
          if (confirm('정말로 이 회의방의 모든 데이터와 세션을 영구 삭제하시겠습니까?')) {
            await remove(roomRootRef); 
            alert('회의방이 완전히 삭제되었습니다.');
            onLeave(); 
          }
        } else {
          alert('관리자 비밀번호가 일치하지 않습니다. 삭제 권한이 없습니다.');
        }
      }
    } catch (error) {
      console.error(error);
      alert('회의방 삭제 중 에러가 발생했습니다.');
    }
  };

const renderCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, data: any, imagesData: Record<string, ImageData>) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

// 1. 저장된 이미지들 그리기
  if (imagesData && typeof imagesData === 'object') {
    // any로 설정된 데이터를 순회할 때 타입 단언(as ImageData)을 사용합니다.
   Object.entries(imagesData).forEach(([_, img]) => {
      const imageObj = new Image();
      imageObj.src = img.url;
      imageObj.onload = () => {
        // 속성이 없을 경우를 대비해 기본값(||)을 명시합니다.
        ctx.drawImage(imageObj, img.x, img.y, img.width, img.height);
      };
    });
  }

  // 2. 선 그리기
  if (!data) return;
  Object.values(data).forEach((line: any) => {
    ctx.beginPath();
    ctx.moveTo(line.startX, line.startY);
    ctx.lineTo(line.endX, line.endY);
    ctx.strokeStyle = (!line.color || line.color === 'black') ? '#f5f5f5' : line.color;
    ctx.lineWidth = line.lineWidth || 1;
    ctx.stroke();
  });
};

useEffect(() => {
  const imagesRef = ref(db, `rooms/${roomName}/images`);
  const unsubscribe = onValue(imagesRef, (snapshot) => {
    setImages(snapshot.val() || {});
  });
  return () => unsubscribe();
}, [roomName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.lineCap = 'round';
      renderCanvas(canvas, ctx, firebaseData || {}, images);
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
        if (line.strokeId) targetStrokeIds.push(line.strokeId); 
      }
    });

    const linesToBackup: any[] = [];

    if (currentMode === 'erase_partial') {
      targetKeys.forEach((key) => {
        if (firebaseData[key]) {
          linesToBackup.push(firebaseData[key]);
          remove(ref(db, `rooms/${roomName}/lines/${key}`));
        }
      });
    } else if (currentMode === 'erase_stroke') {
      if (targetStrokeIds.length > 0) {
        Object.entries(firebaseData).forEach(([key, line]: [string, any]) => {
          if (targetStrokeIds.includes(line.strokeId)) {
            linesToBackup.push(line);
            remove(ref(db, `rooms/${roomName}/lines/${key}`));
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

  // [추가] 이미지 클릭 여부 확인 (클릭한 좌표가 이미지 영역 안에 있는지)
  const clickedImage = Object.entries(images).find(([_, img]) => {
    return clickPos.x >= img.x && clickPos.x <= img.x + img.width &&
           clickPos.y >= img.y && clickPos.y <= img.y + img.height;
  });

  if (clickedImage) {
    const [imageId] = clickedImage;

    // [삭제 로직] 부분 지우개 모드일 때 이미지를 클릭하면 삭제
      if (currentMode === 'erase_partial') {
        if (window.confirm('이 이미지를 삭제하시겠습니까?')) {
          remove(ref(db, `rooms/${roomName}/images/${imageId}`));
          return; // 삭제 후 드로잉 로직 실행 방지
        }
      }
    setSelectedImageId(imageId);
    return; // 이미지를 클릭했으면 드로잉 로직은 건너뜀
  }
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

      ctx.beginPath();
      ctx.moveTo(clickPos.x, clickPos.y);
      ctx.lineTo(clickPos.x + 0.1, clickPos.y + 0.1); 
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = lineWidth; 
      ctx.stroke();

      const newLineRef = push(linesRef);
      set(newLineRef, {
        startX: clickPos.x,
        startY: clickPos.y,
        endX: clickPos.x + 0.1,
        endY: clickPos.y + 0.1,
        strokeId: newId,
        color: selectedColor,
        lineWidth: lineWidth,
        userId: userName 
      });

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
        lineWidth: lineWidth,
        userId: userName 
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
        if (line.strokeId === lastAction.strokeId && line.userId === userName) {
          remove(ref(db, `rooms/${roomName}/lines/${key}`));
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
          lineWidth: lineData.lineWidth || 1,
          userId: lineData.userId || userName
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

  const colors = ['#f5f5f5', '#ff3b30', '#007aff', '#4cd964', '#ffcc00', '#5856d6'];

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', fontFamily: 'var(--font-sans)', backgroundColor: '#0e0e0e' }}>
      
      {/* 우측 상단 실시간 참여자 및 볼륨 조절 패널 */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, backgroundColor: 'rgba(20, 20, 20, 0.92)', backdropFilter: 'blur(12px)', color: '#f5f5f5', padding: '16px 18px', borderRadius: '16px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid rgba(255,255,255,0.1)', minWidth: '200px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#f5f5f5' }}>🏠 방: {roomName}</div>
        
        <button
          onClick={toggleMute}
          disabled={!localStream}
          style={{
            padding: '7px 10px',
            backgroundColor: isMuted ? '#ef4444' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '999px',
            cursor: localStream ? 'pointer' : 'not-allowed',
            fontSize: '11px',
            fontWeight: 'bold',
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            opacity: localStream ? 1 : 0.6
          }}
        >
          {isMuted ? '🔇 마이크 음소거 상태' : '🎙️ 보이스톡 방송 중'}
        </button>

        <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        <div style={{ fontSize: '11px', fontWeight: 500, color: '#9a9a9a', fontFamily: 'var(--font-mono)', marginBottom: '2px' }}>🟢 참여자 목소리 조절 ({roomUsers.length})</div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '160px', overflowY: 'auto', marginBottom: '10px', paddingRight: '2px' }}>
          {roomUsers.map((user: any) => {
  const isMe = user.userName === userName;
  const currentVol = volumes[user.userName] !== undefined ? volumes[user.userName] : 0.8;

  return (
    <div key={user.userName} style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: '#1b1b1b', padding: '8px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '12px', color: isMe ? '#ffffff' : '#c4c4c4', fontWeight: isMe ? 'bold' : 'normal' }}>
          • {user.userName} {isMe && '(나)'}
        </div>
        {!isMe && (
          <button 
            onClick={() => kickUser(user.userName)}
            style={{ fontSize: '10px', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.5)', background: 'none', borderRadius: '999px', cursor: 'pointer', padding: '1px 4px' }}
          >
            강퇴
          </button>
        )}
      </div>
                {!isMe && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <span style={{ fontSize: '10px', color: '#9a9a9a' }}>🔈</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={currentVol} 
                      onChange={(e) => handleVolumeChange(user.userName, parseFloat(e.target.value))}
                      style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '10px', color: '#9a9a9a', minWidth: '22px', textAlign: 'right' }}>
                      {Math.round(currentVol * 100)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <button 
          onClick={onLeave} 
          style={{ padding: '9px', backgroundColor: '#f5f5f5', color: '#0a0a0a', border: 'none', borderRadius: '999px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', textAlign: 'center', transition: 'background-color 0.2s', marginBottom: '4px' }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d4d4d4'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
        >
          🚪 회의방 나가기
        </button>

        <button 
          onClick={handleDeleteRoom} 
          style={{ padding: '9px', backgroundColor: 'transparent', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.5)', borderRadius: '999px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', textAlign: 'center', transition: 'background-color 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,107,107,0.15)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          💥 회의방 삭제
        </button>
      </div>
{/* 툴바 패널 안쪽(색상 선택기나 굵기 조절기 주변)에 추가 */}
<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
  <input 
    type="file" 
    accept="image/*" 
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        push(ref(db, `rooms/${roomName}/images`), { 
          url: reader.result, 
          x: 50, y: 50, width: 200, height: 200 
        });
      };
      reader.readAsDataURL(file);
    }} 
    style={{ display: 'none' }} 
    id="image-upload" 
  />


{/* 선택된 이미지 크기 조절 슬라이더 (좌측 하단 혹은 툴바 아래) */}
{selectedImageId && (
  <div style={{ 
    position: 'absolute', bottom: '20px', left: '20px', padding: '15px', 
    background: 'rgba(20,20,20,0.92)', color: '#f5f5f5', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
    zIndex: 20 
  }}>
    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>이미지 크기 조절</div>
    <input 
      type="range" 
      min="50" max="600" 
      value={selectedImageId && images[selectedImageId] ? images[selectedImageId].width : 200}
      onChange={(e) => {
        const val = parseInt(e.target.value);
        set(ref(db, `rooms/${roomName}/images/${selectedImageId}`), { 
          ...images[selectedImageId], width: val, height: val 
        });
      }}
    />
    <button 
      onClick={() => setSelectedImageId(null)}
      style={{ marginLeft: '10px', padding: '4px 12px', cursor: 'pointer', background: '#f5f5f5', color: '#0a0a0a', border: 'none', borderRadius: '999px', fontWeight: 600 }}
    >닫기</button>
  </div>
)}
      {/* 좌측 상단 드로잉 툴바 패널 */}
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
  style={{
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  }}
>
          <button onClick={() => setCurrentMode('draw')} style={{ padding: '9px 14px', backgroundColor: currentMode === 'draw' ? '#f5f5f5' : '#141414', color: currentMode === 'draw' ? '#0a0a0a' : '#e5e5e5', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>🎨 그리기 모드</button>
          <button onClick={() => setCurrentMode('erase_partial')} style={{ padding: '9px 14px', backgroundColor: currentMode === 'erase_partial' ? '#ff9500' : '#141414', color: currentMode === 'erase_partial' ? '#0a0a0a' : '#e5e5e5', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>🧹 부분 지우개</button>
          <button onClick={() => setCurrentMode('erase_stroke')} style={{ padding: '9px 14px', backgroundColor: currentMode === 'erase_stroke' ? '#8b8aff' : '#141414', color: currentMode === 'erase_stroke' ? '#0a0a0a' : '#e5e5e5', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>✒️ 획 전체 지우개</button>
          <button onClick={handleUndo} style={{ padding: '9px 14px', backgroundColor: '#141414', color: '#e5e5e5', border: '1px dashed rgba(255,255,255,0.35)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>↩️ 되돌리기</button>
          <button onClick={clearCanvas} style={{ padding: '9px 14px', backgroundColor: '#141414', color: '#ff6b6b', border: '1px solid rgba(255,107,107,0.5)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>  전체 지우기</button>
          <label htmlFor="image-upload" style={{ padding: '9px 14px', backgroundColor: '#141414', color: '#e5e5e5', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
      🖼️ 이미지 업로드
    </label>
  </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', backgroundColor: 'rgba(20,20,20,0.92)', border: '1px solid rgba(255,255,255,0.1)', padding: '10px 18px', borderRadius: '999px', boxShadow: '0 12px 32px rgba(0,0,0,0.4)', width: 'fit-content', zIndex: 9999, position:'relative',marginTop: '70px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#9a9a9a', fontFamily: 'var(--font-mono)' }}>색상</span>
            {colors.map((color) => (
              <button key={color} onClick={() => { setSelectedColor(color); setCurrentMode('draw'); }} style={{ width: '24px', height: '24px', backgroundColor: color, border: selectedColor === color ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', cursor: 'pointer', transform: selectedColor === color ? 'scale(1.1)' : 'scale(1)', transition: 'transform 0.1s ease' }} />
            ))}
          </div>
          <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#9a9a9a', fontFamily: 'var(--font-mono)' }}>굵기</span>
            <input type="range" min="1" max="20" step="1" value={lineWidth} onChange={(e) => { setLineWidth(parseInt(e.target.value)); setCurrentMode('draw'); }} style={{ cursor: 'pointer', width: '120px' }} />
            <span style={{ fontSize: '12px', color: '#f5f5f5', fontFamily: 'var(--font-mono)', minWidth: '45px' }}>{lineWidth} mm</span>
          </div>
        </div>
      </div>
      
      <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onMouseLeave={handleMouseUp} style={{ display: 'block', backgroundColor: '#0e0e0e', cursor: getCanvasCursor() }} />
    </div>
  );
};

export default App;