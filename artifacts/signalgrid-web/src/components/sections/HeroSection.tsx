import { motion } from "framer-motion";
import architectureImg from "@/assets/architecture.png";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background pt-24 pb-32 md:pt-32 md:pb-40 border-b border-border/50">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-primary/20 opacity-20 blur-[100px]"></div>
      
      <div className="container relative z-10 mx-auto px-4 md:px-8 max-w-screen-xl">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8 items-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-start text-left"
          >
            <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary mb-6">
              <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
              Runtime Decision Layer
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight">
              Zero Trust at <br className="hidden md:block"/>
              <span className="text-gradient bg-gradient-to-r from-white to-white/50">Workflow Execution.</span>
            </h1>
            
            <p className="text-lg text-muted-foreground mb-8 max-w-[600px] leading-relaxed">
              Enrolled and compliant is not enough. SignalGrid evaluates four signal types simultaneously at the exact moment a shared-device workflow is triggered, producing calibrated access outcomes in real-time.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                Deploy Infrastructure
              </button>
              <button className="inline-flex h-12 items-center justify-center rounded-md border border-input bg-background px-8 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                Read Architecture Docs
              </button>
            </div>
            
            <div className="mt-12 flex items-center space-x-6 text-sm text-muted-foreground">
              <div className="flex items-center">
                <svg className="mr-2 h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                SOC 2 Type II
              </div>
              <div className="flex items-center">
                <svg className="mr-2 h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                On-Premise Ready
              </div>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
            className="relative lg:ml-auto w-full max-w-[600px] aspect-[4/3] rounded-lg border border-border/50 bg-card overflow-hidden shadow-2xl glow-line"
          >
            <div className="absolute top-0 w-full h-8 border-b border-border/50 bg-muted/30 flex items-center px-4 space-x-2">
              <div className="h-2.5 w-2.5 rounded-full bg-border"></div>
              <div className="h-2.5 w-2.5 rounded-full bg-border"></div>
              <div className="h-2.5 w-2.5 rounded-full bg-border"></div>
            </div>
            <img src={architectureImg} alt="SignalGrid Architecture" className="w-full h-full object-cover mt-8 opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent pointer-events-none"></div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
