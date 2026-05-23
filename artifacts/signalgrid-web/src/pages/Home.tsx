import { motion } from "framer-motion";
import HeroSection from "@/components/sections/HeroSection";
import ProblemSection from "@/components/sections/ProblemSection";
import SignalTypesSection from "@/components/sections/SignalTypesSection";
import OutcomesSection from "@/components/sections/OutcomesSection";
import DifferentiatorsSection from "@/components/sections/DifferentiatorsSection";
import IntegrationsSection from "@/components/sections/IntegrationsSection";
import VerticalsSection from "@/components/sections/VerticalsSection";
import DeploymentSection from "@/components/sections/DeploymentSection";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <ProblemSection />
        <SignalTypesSection />
        <OutcomesSection />
        <DifferentiatorsSection />
        <IntegrationsSection />
        <VerticalsSection />
        <DeploymentSection />
      </main>
      <Footer />
    </div>
  );
}
