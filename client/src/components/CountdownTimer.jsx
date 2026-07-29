import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

export default function CountdownTimer({ expiresAt, onExpire }) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const calculateTime = () => {
      const difference = new Date(expiresAt) - new Date();
      if (difference <= 0) {
        setTimeLeft('Expired');
        setIsUrgent(false);
        if (onExpire) onExpire();
        return;
      }

      const mins = Math.floor((difference / 1000 / 60) % 60);
      const secs = Math.floor((difference / 1000) % 60);

      if (mins < 5) {
        setIsUrgent(true);
      }

      setTimeLeft(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  return (
    <div className={`countdown ${isUrgent ? 'urgent' : ''}`}>
      <Timer size={14} />
      <span>{timeLeft}</span>
    </div>
  );
}
