import { Image, ImageStyle, StyleProp, StyleSheet } from 'react-native';

import { usePreferences } from '../contexts/PreferencesContext';
import { useTheme } from '../contexts/ThemeContext';

const LOCKUP = require('../assets/brand/geardrop-logo.png');
const ZH_LOCKUP = require('../assets/brand/zhide-logo.png');
const MARK = require('../assets/brand/geardrop-mark.png');

export function BrandLogo({ markOnly = false, style }: { markOnly?: boolean; style?: StyleProp<ImageStyle> }) {
  const { language } = usePreferences();
  const { colors } = useTheme();
  const chinese = language === 'zh-Hans';

  return (
    <Image
      accessibilityLabel={chinese ? '值de' : 'GearDrop'}
      accessible
      resizeMode="contain"
      source={markOnly ? MARK : chinese ? ZH_LOCKUP : LOCKUP}
      style={[markOnly ? styles.mark : chinese ? styles.zhLockup : styles.lockup, { tintColor: colors.ink }, style]}
    />
  );
}

const styles = StyleSheet.create({
  lockup: {
    width: 160,
    height: 46,
  },
  zhLockup: {
    width: 124,
    height: 46,
  },
  mark: {
    width: 30,
    height: 30,
  },
});
