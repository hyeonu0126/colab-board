import React, { useState } from 'react';

interface RoomUser {
  userName: string;
  peerId?: string | null;
}

interface VoicePanelProps {
  userName: string;
  roomUsers: RoomUser[];
  localStream: MediaStream | null;
  isMuted: boolean;
  volumes: { [key: string]: number };
  toggleMute: () => void;
  handleVolumeChange: (targetName: string, value: number) => void;
  kickUser: (targetName: string) => void;
}

export const VoicePanel: React.FC<VoicePanelProps> = ({
  userName,
  roomUsers,
  localStream,
  isMuted,
  volumes,
  toggleMute,
  handleVolumeChange,
  kickUser,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div style={{ borderTop: '1px solid var(--border)', backgroundColor: 'var(--panel-glass)', display: 'flex', flexDirection: 'column' }}>
      {/* 접기/펼치기 헤더 + 마이크 토글 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px 12px' }}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: '13px', fontWeight: 600, padding: 0 }}
        >
          🎙 음성 채팅 ({roomUsers.length}) {isOpen ? '▾' : '▸'}
        </button>
        <button
          onClick={toggleMute}
          disabled={!localStream}
          style={{
            padding: '6px 12px',
            backgroundColor: isMuted ? '#ef4444' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '999px',
            cursor: localStream ? 'pointer' : 'not-allowed',
            fontSize: '11px',
            fontWeight: 'bold',
            opacity: localStream ? 1 : 0.6,
          }}
        >
          {isMuted ? '🔇 음소거' : '🎙️ 방송 중'}
        </button>
      </div>

      {/* 참여자별 볼륨/강퇴 (높이 제한 + 내부 스크롤) */}
      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', padding: '0 12px 10px' }}>
          {roomUsers.map((user) => {
            const isMe = user.userName === userName;
            const currentVol = volumes[user.userName] !== undefined ? volumes[user.userName] : 0.8;

            return (
              <div key={user.userName} style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--panel-2)', padding: '8px', borderRadius: '10px', border: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '12px', color: isMe ? 'var(--text)' : 'var(--text-soft)', fontWeight: isMe ? 'bold' : 'normal' }}>
                    • {user.userName} {isMe && '(나)'}
                  </div>
                  {!isMe && (
                    <button
                      onClick={() => kickUser(user.userName)}
                      style={{ fontSize: '10px', color: 'var(--danger)', border: '1px solid var(--danger-border)', background: 'none', borderRadius: '999px', cursor: 'pointer', padding: '1px 4px' }}
                    >
                      강퇴
                    </button>
                  )}
                </div>
                {!isMe && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>🔈</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={currentVol}
                      onChange={(e) => handleVolumeChange(user.userName, parseFloat(e.target.value))}
                      style={{ width: '100%', height: '4px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', minWidth: '22px', textAlign: 'right' }}>
                      {Math.round(currentVol * 100)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
