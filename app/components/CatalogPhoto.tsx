import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";

import { DefaultImage } from "./DefaultImage";

type Props = {
  /** Candidate image URLs in priority order. The first one that loads wins. */
  uris: string[];
  category?: string | null;
  brand?: string | null;
  compact?: boolean;
};

/**
 * Yearbook photo: the silhouette placeholder always renders underneath, so a
 * missing, slow, or broken merchant image degrades to the same illustration the
 * Yearbook used before instead of an empty tile.
 */
export function CatalogPhoto({ uris, category, brand, compact }: Props) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const key = uris.join("|");
  const uri = uris.find((value) => !failed[value]);

  useEffect(() => {
    setFailed({});
  }, [key]);

  return (
    <>
      <DefaultImage category={category} brand={brand} compact={compact} />
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          accessibilityIgnoresInvertColors
          onError={() => setFailed((current) => ({ ...current, [uri]: true }))}
        />
      ) : null}
    </>
  );
}
