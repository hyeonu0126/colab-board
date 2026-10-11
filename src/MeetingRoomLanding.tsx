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
        
        <div style={styles.brand}>
          <div style={styles.brandTitle}>Thinc Link</div>
          <div style={styles.brandSub}>Draw it. Say it. Together.</div>
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
  container: { display: 'flex', gap: '24px', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '24px', flexWrap: 'wrap', background: 'radial-gradient(ellipse at 50% 0%, #262626 0%, #0a0a0a 60%)', fontFamily: 'var(--font-sans)', color: '#f5f5f5' },
  card: { width: '400px', padding: '32px', borderRadius: '16px', backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' },
  brand: { textAlign: 'center', marginBottom: '24px' },
  brandTitle: { fontSize: '40px', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1, background: 'linear-gradient(180deg, #ffffff 30%, #8a8a8a 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' },
  brandSub: { marginTop: '8px', fontSize: '12px', color: '#9a9a9a', fontFamily: 'var(--font-mono)' },
  tabContainer: { display: 'flex', marginBottom: '20px', borderRadius: '999px', backgroundColor: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', padding: '4px' },
  tab: { flex: 1, padding: '9px 0', border: 'none', borderRadius: '999px', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '13px', color: '#9a9a9a' },
  activeTab: { backgroundColor: '#262626', color: '#ffffff', fontWeight: 600 },
  form: { display: 'flex', flexDirection: 'column', gap: '15px' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '12px', color: '#9a9a9a', fontWeight: 500 },
  input: { padding: '11px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0a0a0a', color: '#f5f5f5', fontSize: '14px', outline: 'none' },
  submitBtn: { marginTop: '10px', padding: '12px', border: 'none', borderRadius: '999px', backgroundColor: '#f5f5f5', color: '#0a0a0a', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  listCard: { width: '350px', height: '560px', padding: '24px', borderRadius: '16px', backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' },
  listTitle: { fontSize: '13px', fontWeight: 500, color: '#9a9a9a', fontFamily: 'var(--font-mono)', margin: '0 0 15px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' },
  listContainer: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyText: { textAlign: 'center', color: '#6b6b6b', fontSize: '13px', marginTop: '100px' },
  roomItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', backgroundColor: '#1b1b1b' },
  roomInfo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  roomItemName: { fontSize: '14px', fontWeight: 600, color: '#f5f5f5' },
  roomStatus: { fontSize: '11px', color: '#4cd964', fontFamily: 'var(--font-mono)' },
  clickBadge: { fontSize: '11px', padding: '4px 10px', backgroundColor: '#f5f5f5', color: '#0a0a0a', borderRadius: '999px', fontWeight: 600 }
};
