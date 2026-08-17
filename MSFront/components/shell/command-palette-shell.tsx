'use client';

import { Search } from 'lucide-react';
import type { CommandPaletteController } from '@/lib/utils/use-command-palette-controller';

export interface CommandPaletteShellCopy {
  activeBadge: string;
  cancelLabel: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  eyebrow: string;
  openAriaLabel: string;
  searchPlaceholder: string;
  shortcut: string;
  title: string;
  trigger: string;
}

interface CommandPaletteShellProps extends CommandPaletteController {
  copy: CommandPaletteShellCopy;
  hideTrigger?: boolean;
}

export function CommandPaletteShell({
  activeItemId,
  closePalette,
  copy,
  dialogId,
  filteredGroups,
  getItemDomId,
  handleItemHover,
  handlePanelKeyDown,
  handleSearchChange,
  handleSearchKeyDown,
  hideTrigger = false,
  isOpen,
  liveRegionMessage,
  panelRef,
  query,
  resultsId,
  searchInputRef,
  statusId,
  titleId,
  togglePalette,
  triggerRef,
}: CommandPaletteShellProps) {
  return (
    <>
      {hideTrigger ? (
        <button
          ref={triggerRef}
          type="button"
          className="srOnly"
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="commandPaletteTrigger"
          onClick={togglePalette}
          aria-label={copy.openAriaLabel}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={dialogId}
        >
          <Search size={14} />
          <span>{copy.trigger}</span>
          <kbd>{copy.shortcut}</kbd>
        </button>
      )}

      {isOpen ? (
        <div
          className="commandPaletteOverlay gvaCommandOverlay"
          role="presentation"
          onClick={() => closePalette()}
        >
          <section
            id={dialogId}
            ref={panelRef}
            className="commandPalettePanel gvaCommandPanel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={statusId}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handlePanelKeyDown}
          >
            <div className="gvaCommandHeader">
              <input
                ref={searchInputRef}
                className="gvaQuickInput"
                type="search"
                value={query}
                onChange={(event) => handleSearchChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-label={copy.searchPlaceholder}
                aria-controls={resultsId}
                placeholder={copy.searchPlaceholder}
              />
              <h2 id={titleId} className="srOnly">
                {copy.title}
              </h2>
            </div>

            <p id={statusId} className="srOnly" role="status" aria-live="polite">
              {liveRegionMessage}
            </p>

            <div id={resultsId} className="commandPaletteResults" aria-label={copy.title}>
              {filteredGroups.length === 0 ? (
                <div className="emptyStatePanel">
                  <strong>{copy.emptyTitle}</strong>
                  <p>{copy.emptyDescription}</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <section
                    key={group.id}
                    className="commandPaletteGroup"
                    aria-labelledby={`${resultsId}-${group.id}`}
                  >
                    <div className="commandPaletteGroupHeader">
                      <span id={`${resultsId}-${group.id}`} className="serviceCategory">
                        {group.title}
                      </span>
                    </div>
                    <div className="commandPaletteList">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isHighlighted = item.id === activeItemId;
                        const className = [
                          'commandPaletteItem',
                          item.active ? 'active' : '',
                          isHighlighted ? 'highlighted' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        return (
                          <button
                            id={getItemDomId(item.id)}
                            key={item.id}
                            type="button"
                            className={className}
                            onClick={() => {
                              item.onSelect();
                              closePalette({ restoreFocus: false });
                            }}
                            onFocus={() => handleItemHover(item.id)}
                            onMouseEnter={() => handleItemHover(item.id)}
                            aria-current={item.active ? 'page' : undefined}
                          >
                            <div className="commandPaletteItemIcon">
                              <Icon size={16} />
                            </div>
                            <div className="commandPaletteItemCopy">
                              <strong>{item.title}</strong>
                              <span>{item.description}</span>
                            </div>
                            {item.active ? (
                              <span className="securityTag">{copy.activeBadge}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>
            <div className="gvaCommandFooter">
              <button type="button" className="elButton" onClick={() => closePalette()}>
                关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
