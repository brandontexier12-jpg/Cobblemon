import "@fontsource-variable/inter";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout, MorePage } from "./components/Layout";
import { EmptyState, UiProvider } from "./components/ui";
import { AppStateProvider } from "./lib/app-state";
import { setupInstall } from "./lib/install";
import { AutodartsPage } from "./pages/Autodarts";
import { CompetitionDetailPage, CompetitionsPage } from "./pages/Competitions";
import { CareerPage, CareersPage } from "./pages/Career";
import { GamePage } from "./pages/Game";
import { HistoryPage, MatchDetailPage } from "./pages/History";
import { HomePage } from "./pages/Home";
import { PlayPage } from "./pages/Play";
import { PlayerDetailPage, PlayersPage } from "./pages/Players";
import { RoomPage } from "./pages/Room";
import { SettingsPage } from "./pages/Settings";
import { StatsPage } from "./pages/Stats";
import { TrainingPage } from "./pages/Training";

setupInstall();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <AppStateProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="jouer" element={<PlayPage />} />
              <Route path="partie/:id" element={<GamePage />} />
              <Route path="entrainement" element={<TrainingPage />} />
              <Route path="statistiques" element={<StatsPage />} />
              <Route path="joueurs" element={<PlayersPage />} />
              <Route path="joueurs/:id" element={<PlayerDetailPage />} />
              <Route path="competitions" element={<CompetitionsPage />} />
              <Route path="competitions/:id" element={<CompetitionDetailPage />} />
              <Route path="carriere" element={<CareersPage />} />
              <Route path="carriere/:id" element={<CareerPage />} />
              <Route path="historique" element={<HistoryPage />} />
              <Route path="historique/:id" element={<MatchDetailPage />} />
              <Route path="autodarts" element={<AutodartsPage />} />
              <Route path="parametres" element={<SettingsPage />} />
              <Route path="salle" element={<RoomPage />} />
              <Route path="salle/:code" element={<RoomPage />} />
              <Route path="plus" element={<MorePage />} />
              <Route path="*" element={<EmptyState title="Page introuvable">Cette adresse n'existe pas dans DARTS EVOLUTION.</EmptyState>} />
            </Route>
          </Routes>
        </AppStateProvider>
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
