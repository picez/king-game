interface PassScreenProps {
  name: string;
  /** Seat number is shown to disambiguate players who share a name. */
  seatIndex?: number;
  onReady: () => void;
}

export default function PassScreen({ name, seatIndex, onReady }: PassScreenProps) {
  return (
    <div className="pass-screen">
      <div className="pass-card-backs" aria-hidden="true">
        <span className="pass-card-back">🂠</span>
        <span className="pass-card-back">🂠</span>
        <span className="pass-card-back">🂠</span>
      </div>

      <div className="pass-info">
        <p className="pass-title">Pass the device to</p>
        <p className="pass-name">{name}</p>
        {seatIndex !== undefined && (
          <p className="pass-seat">Seat {seatIndex + 1}</p>
        )}
      </div>

      <button className="btn pass-btn" onClick={onReady}>
        I am <strong>{name}</strong> — show my hand
      </button>
    </div>
  );
}
