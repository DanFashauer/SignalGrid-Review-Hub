import React, { useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useGetPolicy, 
  useUpdatePolicy, 
  useDeletePolicy,
  getListPoliciesQueryKey,
  getGetPolicyQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const policySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  workflowPattern: z.string().min(1, "Workflow pattern is required"),
  failMode: z.enum(["fail-open", "fail-closed"]),
  active: z.boolean().default(true),
  rules: z.array(
    z.object({
      signal: z.enum(["identity", "device-posture", "session-context", "operational-signals"]),
      condition: z.string().min(1, "Condition is required"),
      outcome: z.enum(["allow", "step-up", "restrict", "deny"]),
      severity: z.enum(["low", "medium", "high", "critical"]),
    })
  ).min(1, "At least one rule is required")
});

export function PolicyDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: policy, isLoading } = useGetPolicy(id || "");
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();

  const form = useForm<z.infer<typeof policySchema>>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      name: "",
      description: "",
      workflowPattern: "",
      failMode: "fail-closed",
      active: true,
      rules: []
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rules"
  });

  const isInitialized = useRef(false);

  useEffect(() => {
    if (policy && !isInitialized.current) {
      form.reset({
        name: policy.name,
        description: policy.description || "",
        workflowPattern: policy.workflowPattern,
        failMode: policy.failMode as any,
        active: policy.active,
        rules: policy.rules as any
      });
      isInitialized.current = true;
    }
  }, [policy, form]);

  function onSubmit(values: z.infer<typeof policySchema>) {
    if (!id) return;
    updatePolicy.mutate({ id, data: values }, {
      onSuccess: () => {
        toast({ title: "Policy updated", description: "The policy has been saved successfully." });
        queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPolicyQueryKey(id) });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.message || "Failed to update policy", variant: "destructive" });
      }
    });
  }

  function onDelete() {
    if (!id) return;
    deletePolicy.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Policy deleted" });
        queryClient.invalidateQueries({ queryKey: getListPoliciesQueryKey() });
        setLocation("/policies");
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.message || "Failed to delete policy", variant: "destructive" });
      }
    });
  }

  if (isLoading || !policy) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="mb-4">
        <Link href="/policies" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 font-mono uppercase tracking-wider">
          <ArrowLeft className="w-4 h-4" /> Back to Policies
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{policy.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">POLICY ID: {policy.id}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="font-mono text-xs uppercase tracking-wider">
              Delete Policy
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This policy will no longer evaluate access requests.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deletePolicy.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">General Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Policy Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. strict-device-posture" {...field} className="font-mono" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="workflowPattern"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Workflow Pattern</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. wf-aws-*" {...field} className="font-mono" />
                      </FormControl>
                      <FormDescription className="text-[10px]">Glob matching for target workflows</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="What does this policy do?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center gap-8 pt-4">
                <FormField
                  control={form.control}
                  name="failMode"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className="font-mono text-xs uppercase text-muted-foreground mb-2">Fail Mode</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="w-[180px] font-mono text-sm">
                            <SelectValue placeholder="Select fail mode" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="fail-open">FAIL-OPEN</SelectItem>
                          <SelectItem value="fail-closed">FAIL-CLOSED</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-3 shadow-sm w-48">
                      <div className="space-y-0.5">
                        <FormLabel className="font-mono text-xs uppercase text-muted-foreground">Active Status</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Evaluation Rules</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ signal: "identity", condition: "", outcome: "allow", severity: "low" })} className="font-mono text-xs">
                <Plus className="w-4 h-4 mr-2" /> Add Rule
              </Button>
            </CardHeader>
            <CardContent>
              {fields.length === 0 ? (
                <div className="text-muted-foreground text-sm font-mono p-8 border border-dashed border-border rounded text-center">
                  No rules defined. A policy must have at least one rule.
                </div>
              ) : (
                <div className="space-y-4">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-4 p-4 border border-border rounded bg-card/50">
                      <FormField
                        control={form.control}
                        name={`rules.${index}.signal`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-[10px] uppercase font-mono text-muted-foreground">Signal</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="font-mono text-xs h-8">
                                  <SelectValue placeholder="Select signal" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="identity">IDENTITY</SelectItem>
                                <SelectItem value="device-posture">DEVICE-POSTURE</SelectItem>
                                <SelectItem value="session-context">SESSION-CONTEXT</SelectItem>
                                <SelectItem value="operational-signals">OPERATIONAL-SIGNALS</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rules.${index}.condition`}
                        render={({ field }) => (
                          <FormItem className="flex-[2]">
                            <FormLabel className="text-[10px] uppercase font-mono text-muted-foreground">Condition</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. status == 'nominal'" {...field} className="font-mono text-xs h-8" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rules.${index}.outcome`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-[10px] uppercase font-mono text-muted-foreground">Outcome</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="font-mono text-xs h-8">
                                  <SelectValue placeholder="Select outcome" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="allow">ALLOW</SelectItem>
                                <SelectItem value="step-up">STEP-UP</SelectItem>
                                <SelectItem value="restrict">RESTRICT</SelectItem>
                                <SelectItem value="deny">DENY</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`rules.${index}.severity`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-[10px] uppercase font-mono text-muted-foreground">Severity</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="font-mono text-xs h-8">
                                  <SelectValue placeholder="Select severity" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="low">LOW</SelectItem>
                                <SelectItem value="medium">MEDIUM</SelectItem>
                                <SelectItem value="high">HIGH</SelectItem>
                                <SelectItem value="critical">CRITICAL</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        className="mt-6 text-muted-foreground hover:text-destructive h-8 w-8"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => setLocation("/policies")}>Cancel</Button>
            <Button type="submit" disabled={updatePolicy.isPending} className="font-mono uppercase tracking-wider text-xs">
              {updatePolicy.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
