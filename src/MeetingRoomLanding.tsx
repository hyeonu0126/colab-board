import React, { useState, useEffect } from 'react';
import { db } from './firebase'; 
import { ref, get, set, onValue } from 'firebase/database';

interface RoomData {
  roomName: string;
  adminPass: string; 
  joinPass: string;  
  creator: string;
  createdAt: number;
}

interface MeetingRoomLandingProps {
  onJoinSuccess: (roomName: string, userName: string) => void;
}

export const MeetingRoomLanding: React.FC<MeetingRoomLandingProps> = ({ onJoinSuccess }) => {
  const [isCreateMode, setIsCreateMode] = useState<boolean>(true);
  const [roomName, setRoomName] = useState<string>('');
  const [adminPass, setAdminPass] = useState<string>(''); 
  const [joinPass, setJoinPass] = useState<string>('');   
  const [userName, setUserName] = useState<string>('');
  const [existingRooms, setExistingRooms] = useState<RoomData[]>([]);

  // 실시간으로 개설된 방 목록 가져오기
  useEffect(() => {
    const roomsRef = ref(db, 'rooms');
    const unsubscribe = onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const roomList = Object.values(data).map((room: any) => ({
          roomName: room.roomName,
          adminPass: room.adminPass,
          joinPass: room.joinPass,
          creator: room.creator,
          createdAt: room.createdAt
        }));
        setExistingRooms(roomList.sort((a, b) => b.createdAt - a.createdAt));
      } else {
        setExistingRooms([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 회의방 생성 로직
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !adminPass.trim() || !joinPass.trim() || !userName.trim()) {
      alert('모든 필드를 기입해 주세요.');
      return;
    }

    const roomRef = ref(db, `rooms/${roomName.trim()}`);
    
    try {
      const snapshot = await get(roomRef);
      if (snapshot.exists()) {
        alert('이미 존재하는 회의방 이름입니다. 다른 회의방 이름을 입력해 주세요.');
        return;
      }

      const newRoom: RoomData = {
        roomName: roomName.trim(),
        adminPass: adminPass.trim(), 
        joinPass: joinPass.trim(),   
        creator: userName.trim(),
        createdAt: Date.now()
      };

      await set(roomRef, newRoom);
      alert('회의방이 성공적으로 생성되었습니다!');
      onJoinSuccess(roomName.trim(), userName.trim());
    } catch (error) {
      console.error(error);
      alert('회의방 생성 중 오류가 발생했습니다.');
    }
  };

  // 회의방 입장 로직
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !joinPass.trim() || !userName.trim()) {
      alert('회의방 이름, 입장 비밀번호, 닉네임을 모두 입력해 주세요.');
      return;
    }

    const roomRef = ref(db, `rooms/${roomName.trim()}`);

    try {
      const snapshot = await get(roomRef);
      if (!snapshot.exists()) {
        alert('존재하지 않는 회의방입니다.');
        return;
      }

      const roomData = snapshot.val() as RoomData;
      if (roomData.joinPass !== joinPass.trim()) {
        alert('입장 비밀번호가 일치하지 않습니다.');
        return;
      }

      alert(`${roomName} 방에 입장합니다.`);
      onJoinSuccess(roomName.trim(), userName.trim());
    } catch (error) {
      console.error(error);
      alert('회의방 입장 중 오류가 발생했습니다.');
    }
  };

  return (
    <div style={styles.container}>
      {/* 왼쪽: 로그인/입장 폼 카드 */}
      <div style={styles.card}>
        
        {/* 🌟 수정 반영: 이미지 박스의 높이를 강제 제한하고 위아래 공백을 마스킹 컷(Crop) 처리 */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          width: '100%', 
          height: '160px',       /* 로고가 노출될 실제 세로 영역을 타이트하게 제한 */
          overflow: 'hidden',    /* 제한된 높이를 벗어나는 상하 흰색 여백은 잘라버림 */
          marginBottom: '20px',
          borderRadius: '8px'
        }}>
          <img 
            src="/logo.png?v=2" 
            alt="Thinc Link Logo" 
            style={{ 
              width: '100%',     /* 부모 카드 가로폭(340px 내외)에 딱 맞게 풀사이즈 채움 */
              height: '320px',   /* 원본 비율을 무너트리지 않고 중심부를 강조하기 위해 가상 높이 설정 */
              objectFit: 'contain', /* 잘리지 않으면서 빈 여백만 컨트롤 */
              marginTop: '0px'
            }} 
          />
        </div>

        <div style={styles.tabContainer}>
          <button 
            style={{...styles.tab, ...(isCreateMode ? styles.activeTab : {})}} 
            onClick={() => { setIsCreateMode(true); setRoomName(''); setAdminPass(''); setJoinPass(''); setUserName(''); }}
          >
            회의방 만들기
          </button>
          <button 
            style={{...styles.tab, ...(!isCreateMode ? styles.activeTab : {})}} 
            onClick={() => { setIsCreateMode(false); setRoomName(''); setAdminPass(''); setJoinPass(''); setUserName(''); }}
          >
            회의방 참가하기
          </button>
        </div>

        <form onSubmit={isCreateMode ? handleCreateRoom : handleJoinRoom} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>회의방 이름</label>
            <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="방 이름을 입력하세요" style={styles.input} />
          </div>
          
          {isCreateMode && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>관리자 비밀번호 (회의방 관리용)</label>
              <input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="삭제 시 필요한 비밀번호" style={styles.input} />
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>{isCreateMode ? '입장 비밀번호 (참가자 공유용)' : '입장 비밀번호'}</label>
            <input type="password" value={joinPass} onChange={(e) => setJoinPass(e.target.value)} placeholder="방에 입장할 때 쓰는 비밀번호" style={styles.input} />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>{isCreateMode ? '회의방 생성자 닉네임' : '참가자 닉네임'}</label>
            <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="닉네임을 입력하세요" style={styles.input} />
          </div>
          <button type="submit" style={styles.submitBtn}>{isCreateMode ? '방 생성 및 입장' : '방 검증 및 입장'}</button>
        </form>
      </div>

      {/* 오른쪽: 현재 개설된 회의방 리스트 패널 */}
      <div style={styles.listCard}>
        <h3 style={styles.listTitle}>🟢 현재 개설된 회의방 목록 ({existingRooms.length})</h3>
        <div style={styles.listContainer}>
          {existingRooms.length === 0 ? (
            <div style={styles.emptyText}>현재 대기 중인 회의방이 없습니다.</div>
          ) : (
            existingRooms.map((room) => (
              <div 
                key={room.roomName} 
                style={styles.roomItem}
                onClick={() => {
                  setRoomName(room.roomName);
                  setIsCreateMode(false);
                }}
              >
                <div style={styles.roomInfo}>
                  <span style={styles.roomItemName}>🔒 {room.roomName}</span>
                  <span style={styles.roomStatus}>실시간 연결 대기 중</span>
                </div>
                <span style={styles.clickBadge}>선택</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: { display: 'flex', gap: '30px', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f4f6f9', fontFamily: 'sans-serif' },
  card: { width: '400px', padding: '30px', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' },
  tabContainer: { display: 'flex', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#f1f5f9', padding: '4px' },
  tab: { flex: 1, padding: '10px 0', border: 'none', borderRadius: '6px', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', color: '#64748b' },
  activeTab: { backgroundColor: '#ffffff', color: '#0f172a', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  form: { display: 'flex', flexDirection: 'column', gap: '15px' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
  label: { fontSize: '13px', color: '#475569', fontWeight: 600 },
  input: { padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' },
  submitBtn: { marginTop: '10px', padding: '12px', border: 'none', borderRadius: '6px', backgroundColor: '#3b82f6', color: 'white', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' },
  listCard: { width: '350px', height: '530px', padding: '25px', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' },
  listTitle: { fontSize: '16px', fontWeight: 'bold', color: '#0f172a', marginBottom: '15px', borderBottom: '2px solid #f1f5f9', paddingBottom: '10px' },
  listContainer: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyText: { textAlign: 'center', color: '#94a3b8', fontSize: '14px', marginTop: '100px' },
  roomItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'pointer', backgroundColor: '#f8fafc' },
  roomInfo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  roomItemName: { fontSize: '14px', fontWeight: 'bold', color: '#334155' },
  roomStatus: { fontSize: '11px', color: '#10b981', fontWeight: 500 },
  clickBadge: { fontSize: '11px', padding: '4px 8px', backgroundColor: '#e0f2fe', color: '#0369a1', borderRadius: '12px', fontWeight: 'bold' }
};