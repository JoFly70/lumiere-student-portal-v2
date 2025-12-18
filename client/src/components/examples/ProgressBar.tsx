import { ProgressBar } from '../progress-bar';

export default function ProgressBarExample() {
  return (
    <div className="w-80 space-y-4">
      <ProgressBar value={75} variant="primary" />
      <ProgressBar value={45} variant="default" />
    </div>
  );
}
