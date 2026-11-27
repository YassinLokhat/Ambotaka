import React from 'react';
import { Text } from 'react-native';
import { MAP_ATTRIBUTION } from '../../core/config';
import { theme } from '../../core/theme';

export function MapAttribution() {
  return MAP_ATTRIBUTION ? <Text style={{ color: theme.muted, fontSize: 10, textAlign: 'center' }}>{MAP_ATTRIBUTION}</Text> : null;
}
