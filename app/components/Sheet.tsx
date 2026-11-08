import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../contexts/ThemeContext";
import {
  sheetDragOffset,
  sheetRelease,
  sheetRestOffsets,
} from "../lib/sheetGesture";
import { isAccessibilityScale } from "../lib/typeScale";
import type { ThemeColors } from "../lib/theme";

const OPEN_MS = 260;
const CLOSE_MS = 200;
const MAX_HEIGHT_RATIO = 0.92;
/** Height of the grabber strip above the body. */
const HANDLE_HEIGHT = 15;

type Props = {
  visible: boolean;
  /** Asks the owner to flip `visible` to false; the exit animation runs first. */
  onClose: () => void;
  /** Fires once the sheet is off screen, for owners that hold its content. */
  onClosed?: () => void;
  /**
   * Resting heights as a share of the screen, ascending — the sheet opens at
   * the first one and snaps between them while dragged, like a UIKit sheet's
   * detents. Omit it to let the sheet hug its content; it can then still be
   * dragged down to dismiss but has nothing to snap between.
   */
  detents?: number[];
  /** Hides the grabber for sheets that should not be draggable. */
  grabber?: boolean;
  closeAccessibilityLabel?: string;
  style?: ViewStyle;
  children: React.ReactNode;
};

export function Sheet({
  visible,
  onClose,
  onClosed,
  detents,
  grabber = true,
  closeAccessibilityLabel,
  style,
  children,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: screenHeight, fontScale } = useWindowDimensions();

  const stops = useMemo(() => {
    if (!detents?.length) return null;
    const sorted = [...new Set(detents)]
      .map((value) => Math.min(Math.max(value, 0.2), MAX_HEIGHT_RATIO))
      .sort((left, right) => left - right);
    // At the accessibility text sizes the same content needs the whole sheet,
    // so the shorter detents are dropped rather than opening onto clipped text.
    return isAccessibilityScale(fontScale) ? [sorted[sorted.length - 1]!] : sorted;
  }, [detents, fontScale]);
  const fixedHeight = stops ? screenHeight * stops[stops.length - 1]! : null;
  // Offset from the fully expanded position for each detent; index 0 is the
  // shortest detent, which is where the sheet opens.
  const restOffsets = useMemo(
    () => (stops ? sheetRestOffsets(stops, screenHeight) : [0]),
    [screenHeight, stops],
  );
  const initialOffset = restOffsets[0]!;

  const [mounted, setMounted] = useState(visible);
  // Hug-content sheets only know their travel distance after layout.
  const [measured, setMeasured] = useState(fixedHeight ?? screenHeight * 0.5);
  const height = fixedHeight ?? measured;
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const restingOffset = useRef(initialOffset);
  // The body only occupies the part of the sheet that is actually on screen, so
  // bottom-anchored content stays reachable at every detent.
  const visibleHeight = useMemo(
    () =>
      fixedHeight === null
        ? null
        : Animated.subtract(fixedHeight - HANDLE_HEIGHT, translateY),
    [fixedHeight, translateY],
  );

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (fixedHeight !== null) return;
      const next = event.nativeEvent.layout.height;
      if (next > 0) setMeasured(next);
    },
    [fixedHeight],
  );

  const settle = useCallback(
    (offset: number) => {
      restingOffset.current = offset;
      Animated.spring(translateY, {
        toValue: offset,
        useNativeDriver: false,
        damping: 26,
        stiffness: 260,
        mass: 0.9,
      }).start();
    },
    [translateY],
  );

  const runExit = useCallback(
    (done: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: height,
          duration: CLOSE_MS,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: CLOSE_MS,
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => {
        if (finished) done();
      });
    },
    [height, progress, translateY],
  );

  const dismiss = useCallback(() => runExit(onClose), [onClose, runExit]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      restingOffset.current = initialOffset;
      translateY.setValue(height);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: initialOffset,
          useNativeDriver: false,
          damping: 28,
          stiffness: 300,
          mass: 0.9,
        }),
        Animated.timing(progress, {
          toValue: 1,
          duration: OPEN_MS,
          useNativeDriver: false,
        }),
      ]).start();
      return;
    }
    // The parent already flipped `visible`; play the exit, then unmount.
    runExit(() => {
      setMounted(false);
      onClosed?.();
    });
    // `height` settles on the first layout pass and must not restart the entry
    // animation, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 4 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          translateY.setValue(
            sheetDragOffset({
              resting: restingOffset.current,
              dy: gesture.dy,
              restOffsets,
              height,
            }),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const result = sheetRelease({
            resting: restingOffset.current,
            dy: gesture.dy,
            velocity: gesture.vy,
            restOffsets,
            height,
          });
          if (result.kind === "dismiss") dismiss();
          else settle(result.offset);
        },
        onPanResponderTerminate: () => settle(restingOffset.current),
      }),
    [dismiss, height, restOffsets, settle, translateY],
  );

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel}
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
          />
        </Animated.View>
        <Animated.View
          onLayout={onLayout}
          style={[
            styles.sheet,
            fixedHeight !== null
              ? { height: fixedHeight }
              : { maxHeight: screenHeight * MAX_HEIGHT_RATIO },
            { paddingBottom: insets.bottom, transform: [{ translateY }] },
            style,
          ]}
        >
          <View style={styles.handleArea} {...pan.panHandlers}>
            {grabber ? <View style={styles.grabber} /> : null}
          </View>
          {fixedHeight !== null ? (
            <Animated.View style={[styles.bodyFill, { height: visibleHeight }]}>
              {children}
            </Animated.View>
          ) : (
            <View style={styles.bodyHug}>{children}</View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(8,9,10,.42)",
    },
    sheet: {
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      backgroundColor: colors.card,
      overflow: "hidden",
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -2 },
        },
        default: { elevation: 12 },
      }),
    },
    handleArea: {
      height: HANDLE_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 6,
    },
    grabber: {
      width: 36,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.borderStrong,
    },
    bodyFill: { minHeight: 0, overflow: "hidden" },
    bodyHug: { flexShrink: 1 },
  });
