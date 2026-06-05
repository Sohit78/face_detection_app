import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './src/AppContext';
import { RootStackParamList } from './src/navigation';
import { colors } from './src/theme';
import HomeScreen from './src/screens/HomeScreen';
import EnrollScreen from './src/screens/EnrollScreen';
import VerifyScreen from './src/screens/VerifyScreen';
import RecordsScreen from './src/screens/RecordsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: colors.white,
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'NHAI Face Auth' }}
            />
            <Stack.Screen name="Enroll" component={EnrollScreen} options={{ title: 'Enroll Personnel' }} />
            <Stack.Screen name="Verify" component={VerifyScreen} options={{ title: 'Mark Attendance' }} />
            <Stack.Screen name="Records" component={RecordsScreen} options={{ title: 'Records & Sync' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}
