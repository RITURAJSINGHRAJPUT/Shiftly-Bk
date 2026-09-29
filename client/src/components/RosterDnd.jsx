import {
  useDraggable, useDroppable, useSensor, useSensors, MouseSensor, TouchSensor,
  pointerWithin, rectIntersection,
} from '@dnd-kit/core';

/**
 * Drag-and-drop pieces for Shift Planning, kept out of ShiftsPage so the page
 * reads as roster logic rather than drag plumbing.
 *
 * Every draggable here is also a button that opens its editor, so neither
 * sensor may start a drag on a plain click or tap: the mouse has to travel a
 * few pixels first, and a finger has to press and hold — which also leaves an
 * ordinary swipe free to scroll the page.
 */
export function useRosterSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
}

/**
 * The drop target under the pointer, innermost first.
 *
 * Targets nest — a name sits in a shift block, which sits in a day card — and
 * the default rectangle overlap would pick whichever the dragged chip happened
 * to cover most, so dropping on a person could land on their block instead.
 * pointerWithin ranks the smallest rectangle around the pointer first.
 */
export function rosterCollision(args) {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
}

/**
 * A person's name that can be picked up, dropped on, or both — dropping one
 * name on another is a swap. Still a button: a click opens the editor.
 *
 * Ids must be unique across the page, and the same shift shows in both the
 * daily card and the week, so callers prefix them with where they render.
 */
export function RosterName({
  id, dragData, dropData, className = '', children, ...rest
}) {
  const drag = useDraggable({ id: `drag:${id}`, data: dragData, disabled: !dragData });
  const drop = useDroppable({ id: `drop:${id}`, data: dropData, disabled: !dropData });
  const setRef = (node) => { drag.setNodeRef(node); drop.setNodeRef(node); };
  const over = drop.isOver && drop.active && drop.active.id !== `drag:${id}`;

  return (
    <button
      ref={setRef}
      type="button"
      className={[
        className,
        dragData && 'is-draggable',
        drag.isDragging && 'is-dragging',
        over && 'is-drop-target',
      ].filter(Boolean).join(' ')}
      {...(dragData ? drag.listeners : {})}
      {...(dragData ? drag.attributes : {})}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A block, row or day card that accepts a dropped name. */
export function DropZone({
  id, data, as: Tag = 'div', className = '', children, ...rest
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `zone:${id}`, data, disabled: !data });
  return (
    <Tag
      ref={setNodeRef}
      className={[className, isOver && active && 'is-drop-target'].filter(Boolean).join(' ') || undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
