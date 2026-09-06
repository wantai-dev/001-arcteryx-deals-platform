import AsyncStorage from '@react-native-async-storage/async-storage';
import { WatchlistStore } from './watchlistStore';

export const watchlistStore = new WatchlistStore(AsyncStorage);
