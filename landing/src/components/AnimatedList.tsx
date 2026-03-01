import { useRef, useState, useEffect, useCallback, type ReactNode, type MouseEventHandler, type UIEvent } from 'react';
import './AnimatedList.css';

interface AnimatedItemProps {
  children: ReactNode;
  delay?: number;
  index: number;
  onMouseEnter?: MouseEventHandler;
  onClick?: MouseEventHandler;
}

function AnimatedItem({ children, delay = 0, index, onMouseEnter, onClick }: AnimatedItemProps) {
  return (
    <li
      data-index={index}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className="animated-list-item"
    >
      {children}
    </li>
  );
}

interface AnimatedListProps {
  items: ReactNode[];
  onItemSelect?: (index: number) => void;
  showGradients?: boolean;
  enableArrowNavigation?: boolean;
  className?: string;
  displayScrollbar?: boolean;
}

export default function AnimatedList({
  items,
  onItemSelect,
  showGradients = true,
  enableArrowNavigation = true,
  className = '',
  displayScrollbar = true,
}: AnimatedListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const [topGradientOpacity, setTopGradientOpacity] = useState(0);
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(1);

  const handleScroll = useCallback((e: UIEvent<HTMLUListElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    setTopGradientOpacity(Math.min(scrollTop / 50, 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    setBottomGradientOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1));
  }, []);

  useEffect(() => {
    if (!enableArrowNavigation) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        onItemSelect?.(selectedIndex);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items.length, selectedIndex, onItemSelect, enableArrowNavigation]);

  useEffect(() => {
    if (!keyboardNav || selectedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    setKeyboardNav(false);
  }, [selectedIndex, keyboardNav]);

  return (
    <div className={`animated-list-container ${className}`}>
      {showGradients && (
        <div className="animated-list-gradient animated-list-gradient--top" style={{ opacity: topGradientOpacity }} />
      )}

      <ul
        ref={listRef}
        className={`animated-list ${displayScrollbar ? '' : 'animated-list--no-scrollbar'}`}
        onScroll={handleScroll}
      >
        {items.map((item, index) => (
          <AnimatedItem
            key={index}
            index={index}
            delay={index}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => { setSelectedIndex(index); onItemSelect?.(index); }}
          >
            <div className={`animated-list-item-inner ${selectedIndex === index ? 'animated-list-item-inner--selected' : ''}`}>
              {item}
            </div>
          </AnimatedItem>
        ))}
      </ul>

      {showGradients && (
        <div className="animated-list-gradient animated-list-gradient--bottom" style={{ opacity: bottomGradientOpacity }} />
      )}
    </div>
  );
}
