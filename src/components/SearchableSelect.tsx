import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText: string;
  detail?: string;
}

interface SearchableSelectProps {
  id: string;
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  required?: boolean;
  onChange: (value: string) => void;
}

const normalizeSearchText = (text: string) =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export const filterSearchableOptions = (
  options: SearchableSelectOption[],
  query: string
): SearchableSelectOption[] => {
  const normalizedQuery = normalizeSearchText(query.trim());
  return options.filter(
    (option) =>
      !normalizedQuery ||
      normalizeSearchText(option.searchText).includes(normalizedQuery)
  );
};

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  value,
  options,
  placeholder,
  required = false,
  onChange
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = useMemo(
    () => filterSearchableOptions(options, query),
    [options, query]
  );

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const input = inputRef.current;
      if (!input) return;

      const rect = input.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(0, Math.min(288, openAbove ? spaceAbove : spaceBelow));

      setPosition({
        left: rect.left,
        top: openAbove ? rect.top - maxHeight - 4 : rect.bottom + 4,
        width: rect.width,
        maxHeight
      });
    };

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !inputRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setQuery('');
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [activeIndex, filteredOptions.length]);

  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const selectOption = (option: SearchableSelectOption) => {
    onChange(option.value);
    setQuery('');
    setIsOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setQuery('');
        setIsOpen(true);
      } else if (filteredOptions.length) {
        setActiveIndex((index) => (index + 1) % filteredOptions.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setQuery('');
        setIsOpen(true);
      } else if (filteredOptions.length) {
        setActiveIndex((index) => (index - 1 + filteredOptions.length) % filteredOptions.length);
      }
    } else if (event.key === 'Enter' && isOpen && filteredOptions[activeIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setQuery('');
    }
  };

  const listbox = isOpen && position
    ? createPortal(
        <div
          id={`${id}-listbox`}
          ref={listRef}
          role="listbox"
          className="fixed z-[60] overflow-y-auto rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] py-1 shadow-2xl"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight
          }}
        >
          {filteredOptions.length ? (
            filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;

              return (
                <button
                  key={option.value}
                  id={`${id}-option-${index}`}
                  data-option-index={index}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-amber-500/20 text-[#171717]'
                      : isActive
                        ? 'bg-[#EAE8E2] text-[#171717]'
                        : 'text-[#171717] hover:bg-[#EAE8E2]'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{option.label}</span>
                    {isSelected && (
                      <span className="material-symbols-outlined text-sm text-amber-600">check</span>
                    )}
                  </span>
                  {option.detail && (
                    <span className="mt-1 block text-[10px] text-[#77766F]">{option.detail}</span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-3 text-xs text-[#77766F]">Nenhum resultado encontrado.</p>
          )}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            isOpen && filteredOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined
          }
          aria-required={required}
          autoComplete="off"
          required={required && !value}
          value={isOpen ? query : selectedOption?.label ?? ''}
          placeholder={selectedOption && !isOpen ? selectedOption.label : placeholder}
          onFocus={() => {
            setQuery('');
            setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
            setIsOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onBlur={() => {
            setIsOpen(false);
            setQuery('');
          }}
          onKeyDown={handleKeyDown}
          className="w-full h-10 px-3 pr-9 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-500"
        />
        {value ? (
          <button
            type="button"
            aria-label="Limpar seleção"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#77766F] hover:text-[#171717]"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        ) : (
          <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-base text-[#77766F]">
            search
          </span>
        )}
      </div>
      {listbox}
    </>
  );
};
