import { queryOrdersSchema, executeQueryOrders } from "./queryOrdersTool";
import { queryRecoveryStatsSchema, executeQueryRecoveryStats } from "./queryRecoveryStatsTool";
import { queryFailureTrendsSchema, executeQueryFailureTrends } from "./queryFailureTrendsTool";
import { rankCustomersSchema, executeRankCustomers } from "./rankCustomersTool";
import { generateReportSchema, executeGenerateReport } from "./generateReportTool";

export const ANALYTICS_TOOL_SCHEMAS = [
  queryOrdersSchema,
  queryRecoveryStatsSchema,
  queryFailureTrendsSchema,
  rankCustomersSchema,
  generateReportSchema,
];

const TOOL_EXECUTORS: Record<string, (args: any) => Promise<any>> = {
  query_orders: executeQueryOrders,
  query_recovery_stats: executeQueryRecoveryStats,
  query_failure_trends: executeQueryFailureTrends,
  rank_customers_by_failures: executeRankCustomers,
  generate_recovery_report: executeGenerateReport,
};

export async function executeAnalyticsTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const executor = TOOL_EXECUTORS[tool];
  if (!executor) throw new Error(`Unknown analytics tool: ${tool}`);
  return executor(args);
}
