import { useEffect, useState } from 'react';
import { Slider } from '@astryxdesign/core/Slider';
import type { ReaderRendition } from '../../services/reader/epubAdapter';
import type { ReadingEngineRendition } from '../../services/reader/readingEngine';
import './ReaderProgressBar.css';

export function ReaderProgressBar(params: {
  percentage: number;
  rendition: ReaderRendition | null;
  onSeek: (fraction: number) => void;
}) {
  const { percentage, rendition, onSeek } = params;
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [marks, setMarks] = useState<Array<{ value: number }>>([]);

  useEffect(() => {
    setDragValue(null);
    if (!rendition) {
      setMarks([]);
      return;
    }

    const fractions = (rendition as ReadingEngineRendition).getSectionFractions?.() ?? [];
    setMarks(fractions.map((fraction) => ({ value: fraction * 100 })));
  }, [rendition]);

  const displayValue = dragValue ?? percentage;

  return (
    <div className="reader-progress-bar">
      <Slider
        label="全书进度"
        isLabelHidden
        value={displayValue}
        min={0}
        max={100}
        step={0.1}
        valueDisplay="tooltip"
        formatValue={(value) => `${Math.round(value)}%`}
        marks={marks.length > 1 ? marks : undefined}
        onChange={(value: number | [number, number]) => {
          if (typeof value === 'number') setDragValue(value);
        }}
        onChangeEnd={(value: number | [number, number]) => {
          if (typeof value !== 'number') return;
          setDragValue(null);
          onSeek(value / 100);
        }}
      />
    </div>
  );
}
